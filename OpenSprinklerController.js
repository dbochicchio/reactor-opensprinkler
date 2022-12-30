/** A Reactor controller for OpenSprinkler.
 *  Copyright (c) 2022 Daniele Bochicchio, All Rights Reserved.
 *  OpenSprinklerController is offered under MIT License - https://mit-license.org/
 *  More info: https://github.com/dbochicchio/reactor-opensprinkler
 *
 *  Disclaimer: Thi is beta software, so quirks anb bugs are expected. Please report back.
 */

const version = 221230;
const className = "opensprinkler";
const ns = "x_opensprinkler"
const ignoredValue = "@@IGNORED@@"

const Controller = require("server/lib/Controller");

const Logger = require("server/lib/Logger");
Logger.getLogger('OpenSprinklerController', 'Controller').always("Module OpenSprinklerController v%1", version);

const Configuration = require("server/lib/Configuration");
const logsdir = Configuration.getConfig("reactor.logsdir");  /* logs directory path if you need it */

// modules
const util = require("server/lib/util");

const delay = ms => new Promise(res => setTimeout(res, ms));

var impl = false;  /* Implementation data, one copy for all instances, will be loaded by start() later */

module.exports = class OpenSprinklerController extends Controller {
    constructor(struct, id, config) {
        super(struct, id, config);  /* required *this.*/

        this.failures = 0;

        this.mqttController = undefined;

        this.stopping = false;      /* Flag indicates we're stopping */
    }

    /** Start the controller. */
    async start() {
        if (this.config.host == undefined) {
            return Promise.reject("No host configured");
        }

        if (this.config.password == undefined) {
            return Promise.reject("No password configured");
        }

        /** Load implementation data if not yet loaded. Remove this if you don't
         *  use implementation data files.
         */
        if (false === impl) {
            impl = await this.loadBaseImplementationData(className, __dirname);
        }

        this.log.debug(5, "%1 starting", this);

        this.stopping = false;
        this.run();

        return this;
    }

    /* Stop the controller. */
    async stop() {
        this.log.notice("%1 stopping", this);
        this.stopping = true;

        // unsubscribe from qtt
        if (this.mqttController !== undefined)
            this.mqttController.extUnsubscribeTopic(this, null);

        /* Required ending */
        return await super.stop();
    }

    /* run() is called when Controller's single-simple timer expires. */
    run() {
        this.log.debug(5, "%1 running", this);

        this.refreshStatus();
    }

    /* refreshStatus() load status and creates the entities */
    refreshStatus() {
        if (this.stopping) return;

        const apiUrl = this.composeUrl("ja?");
        this.log.notice("%1 [refreshStatus] - started", this);
        this.fetchJSON(apiUrl, { timeout: this.config.timeout || 15_000 }).then(async (response) => {
            this.log.debug(5, "%1 replied with %2", this, response);
            this.failures = 0;

            this.log.debug(5, "%1 Number of stations: %2", this, response?.stations?.snames?.length ?? 0);
            // get stations
            if (response?.stations?.snames)
                response.stations.snames.forEach((station, index) => {
                    var id = `os_station_${index + 1}`;

                    // ● ps: Program status data: each element is a 3-field array that stores the [pid,rem,start] of a station, wher
                    var ps = response.settings.ps[index];
                    var state = response.status.sn[index] > 0;

                    // TODO: string sensor?
                    this.mapDevice(id, station || `Station #${index + 1}`,
                        ["irrigation_zone", "power_switch", "toggle", ns], "irrigation_zone.state",
                        {
                            //"irrigation_zone.duration": -1, // TODO? not supported?
                            "irrigation_zone.remaining": ps[1],
                            "irrigation_zone.last_run": ps[2] > 0 ? ps[2] : ignoredValue,
                            //"irrigation_zone.next_run": -1, // TODO? not supported?
                            "irrigation_zone.enabled": (response.stations.stn_dis[parseInt(index / 8)] & (1 << (index % 8))) == 0,
                            "irrigation_zone.state": state,
                            "power_switch.state": state,
                            "toggle.state": state,
                            "_ns_.scheduled": ps[0] > 0,
                            "_ns_.id": index,
                            "_ns_.type": "zone"
                        });
                });

            // get programs
            var programs = response?.programs?.length ?? response?.programs?.nprogs ?? 0;
            this.log.debug(5, "%1 Number of programs: %2", this, programs);
            if (programs > 0) {
                for (let index = 0; index < programs; index++) {
                    var id = `os_program_${index + 1}`;
                    var pd = response.programs.pd[index];
                    var state = ((pd[0] >> 0) & 1) ? true : false;

                    this.log.debug(5, "%1 Program #%2: %3", this, index, state);

                    // https://github.com/OpenSprinkler/OpenSprinkler-App/blob/6116c514cbf3a5f25613ab6dbad8ddafc00ceec1/www/js/main.js#L8408
                    this.mapDevice(id, pd[5] || `Program #${index + 1}`,
                        ["irrigation_zone", "power_switch", "toggle", ns], "irrigation_zone.state",
                        {
                            //"irrigation_zone.duration": -1, // TODO?
                            //"irrigation_zone.remaining": -1, // TODO?
                            //"irrigation_zone.last_run": -1, // TODO
                            //"irrigation_zone.next_run": -1, // TODO
                            "irrigation_zone.enabled": ((pd[0] >> 0) & 1) ? true : false,
                            "irrigation_zone.state": state,
                            "power_switch.state": state,
                            "toggle.state": state,
                            "_ns_.id": index,
                            "_ns_.type": "program",
                            "_ns_.programflag": pd[0],
                            "_ns_.programdata": pd[4], //?.join(',') || '',
                            "_ns_.weather": ((pd[0] >> 1) & 1) ? true : false
                            // "_ns_.days_even": (((pd[0] >> 2) & 0x03) === 2),
                            // "_ns_.days_odd": (((pd[0] >> 2) & 0x03) === 1),
                            // "_ns_.days_hasinterval": (((pd[0] >> 4) & 0x03) === 3),
                        });
                }
            }

            // sensors
            let rdState = (response?.settings?.rd || 0) == 1;
            this.mapDevice("os_raindelay", "Rain Delay", ["binary_sensor", "power_switch", "toggle", "string_sensor", `${ns}_raindelay`, ns], "binary_sensor.state",
                {
                    "binary_sensor.state": rdState,
                    "power_switch.state": rdState,
                    "toggle.state": rdState,
                    "string_sensor.value": response.settings.rdst,
                    "_ns_.type": "raindelay"
                });

            this.mapSensorDevice("1", response?.settings?.sn1, response?.settings?.sn1t, response?.settings?.sn1o);
            this.mapSensorDevice("2", response?.settings?.sn2, response?.settings?.sn2t, response?.settings?.sn2o);

            this.mapDevice("os_waterlevel", "Water Level", ["string_sensor", ns], "string_sensor.value",
                {
                    "string_sensor.value": response?.options?.wl || 0,
                    "string_sensor.units": "%",
                    "_ns_.type": "waterlevel",
                });

            // controller status
            var lrun = response?.settings?.lrun;

            this.mapDevice("system", 'Open Sprinkler', ["power_switch", "toggle", "string_sensor", ns], "string_sensor.value",
                {
                    "power_switch.state": (response?.settings?.en || response?.options?.den == 0) == 1,
                    "toggle.state": (response?.settings?.en || response?.options?.den == 0) == 1,
                    "string_sensor.value": (response?.settings?.en || response?.options?.den == 0) == 1 ? "Enabled" : "Disabled",
                    "_ns_.type": "controller",
                    "_ns_.current": (response?.settings?.curr || 0),
                    "_ns_.hardwareVersion": this.getHardwareVersion(response?.options?.hwv, response?.options?.hwt),
                    "_ns_.weatheradjustmentmode": (response?.settings?.uwt || 0),
                    "_ns_.rssi": (response?.settings?.RSSI),
                    "_ns_.firmwareversion": (response?.options?.fwv || '0'),
                    "_ns_.lastboot": (response?.settings?.lupt || 0),
                    "_ns_.lastbootreason": (response?.settings?.lrbtc || 0),
                    "_ns_.boards": (response?.settings?.nbrd || 1),
                    "_ns_.lastrun": (lrun)
                });

            // update last run in child
            if (lrun) {
                // lrun: Last run record, which stores the [station index, program index, duration, end time] of the last run station.
                var stationId = lrun[0];
                var programId = lrun[1];
                var duration = lrun[2];
                var endTime = lrun[3];

                if (duration > 0 && endTime > 0) {
                    this.updateEntityAttributes(this.findEntity(`os_program_${programId + 1}`), {
                        "irrigation_zone.last_run": endTime - duration,
                        "irrigation_zone.duration": duration,
                    });

                    this.updateEntityAttributes(this.findEntity(`os_station_${stationId + 1}`), {
                        "irrigation_zone.last_run": endTime - duration,
                        "irrigation_zone.duration": duration,
                    });
                }
            }

            // MQTT support
            var useMqtt = false;
            if (response?.settings?.mqtt?.en == 1) {

                if (this.mqttController === undefined) {
                    this.log.notice("%1 [refreshStatus] - MQTT support enabled", this);

                    // ignored ATM
                    // var mqtt_host = response?.settings?.mqtt?.host;
                    // var mqtt_port = response?.settings?.mqtt?.port;
                    // var mqtt_username = response?.settings?.mqtt?.user;
                    // var mqtt_password = response?.settings?.mqtt?.pass;

                    useMqtt = this.registerMqttController();
                }
                else
                    useMqtt = true;
            }

            this.online();

            this.log.notice("%1 [refreshStatus] - completed - MQTT: %2", this, useMqtt);

            if (!useMqtt)
                this.startDelay(this.config.interval || 5_000);
        }).catch(err => {
            this.log.err("%1 [refreshStatus] error: %2", this, err);
            this.startDelay(Math.min(120_000, (this.config.error_interval || 5_000) * Math.max(1, ++this.failures - 12)));

            if (this.failures >= 3) {
                this.offline();
            }
        });
    }

    /* init MQTT message handler, if needed */
    registerMqttController() {
        this.log.notice("%1 [registerMqttController] started - %2", this, this.mqttController);
        if (this.mqttController === undefined) {
            try {
                var mqttControllerId = this.config.mqtt_controller || 'mqtt';
                this.mqttController = this.getStructure().getControllerByID(mqttControllerId);

                if (this.mqttController !== undefined) {
                    this.log.notice("%1 [registerMqttController] MQTT topic subscription in progress for %2", this, mqttControllerId);
                    // Using bind() to use a method of your controller as handler:
                    this.mqttController.extSubscribeTopic(this, "opensprinkler/#", this.onMqttMessage.bind(this));
                    return true; // no need to refresh
                }
                else {
                    this.log.err("%1 [registerMqttController] MQTT is configured, but can't find '%2' under MSR. Check your config.", this, mqttControllerId);
                    return false;
                }
            } catch (err) {
                this.log.err("%1 [registerMqttController] error: %2", this, err);
            }
        }

        return this.mqttController !== undefined; // if MQTT setup is not valid, keep polling
    }

    /* performOnEntity() is used to implement actions on entities */
    async performOnEntity(entity, actionName, params) {
        this.log.notice("%1 [performOnEntity] %3 - %2 - %4", this, actionName, entity, params);

        switch (actionName) {
            case 'irrigation_zone.run':
            case 'power_switch.on':
                return this.switchEntityAsync(entity, true);
            case 'irrigation_zone.stop':
            case 'power_switch.off':
                return this.switchEntityAsync(entity, false);
            case 'irrigation_zone.enable':
                return this.enableEntityAsync(entity, true);
            case 'irrigation_zone.disable':
                return this.enableEntityAsync(entity, false);
            case 'power_switch.set':
            case 'irrigation_zone.set':
            case 'toggle.toggle':
                return this.switchEntityAsync(entity, params?.state, params?.duration);
            // x_opensprinkler
            case 'x_opensprinkler_raindelay.set':
                return this.switchEntityAsync(entity, true, params?.hours);
            case 'sys_system.restart':
                this.mqttController = undefined;
                this.refreshStatus();
                return;
        }

        return super.performOnEntity(entity, actionName, params);
    }

    /* calls the APIs to enable/disable zones and programs */
    async enableEntityAsync(e, state) {
        this.log.notice("%1 enableEntityAsync(%2, %3, %4)", this, e, state);

        // we're using power_switch.state since it's shared with controller
        var currentState = e.getAttribute('irrigation_zone.enabled');

        // toggle
        if (state === undefined) {
            this.log.debug(5, "%1 currentState: %2", this, currentState);
            state = !currentState;
        }

        var deviceType = e.getAttribute(`${ns}.type`);
        var isZone = deviceType == "zone";
        var isProgram = deviceType == "program";
        // var isController = deviceType == "controller";
        // var isRainDelay = deviceType == "raindelay";

        var id = e.getAttribute(`${ns}.id`) || '-1';
        var attributes = {};
        var command;
        var cmdParams;

        if (isZone) {
            command = "cs";
            cmdParams = {};

            let systemE = this.findEntity("system");
            let nbrd = systemE.getAttribute(`${ns}.boards`); // number of boards
            this.log.debug(5, "%1 [enableEntityAsync] Zones - Number of boards: %2", this, nbrd);

            // a special flag need to be computed - see docs
            for (let bid = 0; bid < nbrd; bid++) {
                cmdParams["d" + bid] = 0;

                this.log.debug(5, "%1 [enableEntityAsync] Zones - Board: #%2", this, bid);
                for (let s = 0; s < 8; s++) {
                    var sid = bid * 8 + s;

                    // get current status
                    let zoneE = this.findEntity(`os_station_${sid + 1}`);
                    if (zoneE) {
                        var newState = zoneE.getAttribute("irrigation_zone.enabled");

                        // if this is the station we're trying to update, compute the status
                        if (zoneE.getCanonicalID() == e.getCanonicalID())
                            newState = state;

                        this.log.debug(5, "%1 [enableEntityAsync] Zones - Station: #%2 - New State: %3", this, sid, newState);

                        cmdParams["d" + bid] = (cmdParams["d" + bid]) + ((newState ? 0 : 1) << s);
                    }
                }
            }

            attributes = {
                "irrigation_zone.enabled": state,
            };
        }
        else if (isProgram) {
            command = "cp";
            cmdParams = {
                "en": state ? "1" : "0",	                    // enable flag
                "pid": id,          	                        // program id, for programs
            };
            attributes = {
                "irrigation_zone.enabled": state,
            };
        }

        if (command) {
            await this.postCommandAsync(command, cmdParams, e, attributes);
        }
        else {
            this.log.err("%1 [enableEntityAsync] error: %2 - %3 - %4", this, e, state, duration);
        }
    }

    /* calls the APIs to turn on/off zones, programs, controller and rain delay */
    async switchEntityAsync(e, state, duration) {
        this.log.notice("%1 switchEntityAsync(%2, %3, %4)", this, e, state, duration);

        var defaultDuration = this.config.default_zone_duration || 60;

        // we're using power_switch.state since it's shared with controller
        var currentState = e.getAttribute('power_switch.state');

        // toggle
        if (state === undefined) {
            this.log.debug(5, "%1 [switchEntityAsync] currentState: %2", this, currentState);
            state = !currentState;
        }

        var deviceType = e.getAttribute(`${ns}.type`);
        var isZone = deviceType == "zone";
        var isProgram = deviceType == "program";
        var isController = deviceType == "controller";
        var isRainDelay = deviceType == "raindelay";

        var id = e.getAttribute(`${ns}.id`) || '-1';
        var attributes = {};
        var command;
        var cmdParams = {
            "en": state ? "1" : "0",	                    // enable flag
            "t": state ? duration || defaultDuration : 0,   // timeout, for programs only
            "sid": id,	                          	        // station id, for zones
            "pid": id,          	                        // program id, for programs
            "uwt": 0		            			        // use weather adjustment
        };

        this.log.debug(5, "%1 [switchEntityAsync] Type: %2 - Zone: %3 - Program: %4 - Controller: %5 - RainDelay: %6", this, deviceType, isZone, isProgram, isController, isRainDelay);

        if (isController) {
            cmdParams = {
                "en": state ? "1" : "0",	    // enable flag
            };
            command = "cv"; // change variables command to enable/disable controller

            attributes = {
                "string_sensor.value": state ? "Enabled" : "Disabled",
                "power_switch.state": state,
                "toggle.state": state
            };
        }
        else if (isZone) {
            command = "cm";
            attributes = {
                "irrigation_zone.state": state,
                "power_switch.state": state,
                "toggle.state": state,
                "irrigation_zone.duration": duration ?? ignoredValue,
                "irrigation_zone.remaining": state ? duration || defaultDuration : 0
            };
        }
        else if (isProgram) {
            // special case for off: parse stationdata and stop stations where v>0
            if (!state) {
                var programData = e.getAttribute(`${ns}.programdata`);
                for (let index = 0; index < programData.length; index++) {
                    if (programData[0] > 0) {
                        let zoneE = this.findEntity(`os_program_${index + 1}`);
                        await switchEntityAsync(zoneE, false);
                    }
                }
                return;
            }

            command = "mp";
            attributes = {
                "irrigation_zone.state": state,
                "power_switch.state": state,
                "toggle.state": state,
                "irrigation_zone.duration": duration ?? ignoredValue,
                "irrigation_zone.remaining": state ? duration || defaultDuration : 0
            };
        }
        else if (isRainDelay) {
            command = "cv"; // change variables command to enable/disable controller

            var rdHours = (!state || duration == 0) ? 0 : duration || this.config.default_raindelay_duration || 1;
            cmdParams = {
                "rd": rdHours, // rain delay in hours - 0 if disabled
            };

            var rdDate = new Date();
            attributes = {
                "binary_sensor.value": rdHours > 0,
                "power_switch.state": rdHours > 0,
                "toggle.state": rdHours > 0,
                "string_sensor.value": rdHours <= 0 ? 0 : (Math.floor(rdDate / 1000) + (3600 * rdHours)),
            };
        }

        this.log.debug(5, "%1 [switchEntityAsync] Command: %2 - Parameters: %3", this, command, cmdParams);

        if (command) {
            return this.postCommandAsync(command, cmdParams, e, attributes);
        }
        else {
            this.log.err("%1 [switchEntityAsync] error: %2 - %3 - %4", this, e, state, duration);
        }

        return;
    }

    handleResponse(response) {
        // o {"result":1} Success
        // o {"result":2} Unauthorized (e.g. missing password or password is incorrect)
        // o {"result":3} Mismatch (e.g. new password and confirmation password do not match)
        // o {"result":16} Data Missing (e.g. missing required parameters)
        // o {"result":17} Out of Range (e.g. value exceeds the acceptable range)
        // o {"result":18} Data Format Error (e.g. provided data does not match required format)
        // o {"result":19} RF code error (e.g. RF code does not match required format)
        // o {"result":32} Page Not Found (e.g. page not found or requested file missing)
        // o {"result":48} Not Permitted (e.g. cannot operate on the requested station
    }

    async postCommandAsync(url, params, e, attributes, failures) {
        var qs = "?";
        for (const p in params) {
            qs += `${p}=${params[p]}&`;
        };

        if (!failures) failures = 0;

        const max_retries = 3;
        const apiUrl = this.composeUrl(url + qs);
        this.log.notice("%1 [postCommandAsync] %2", this, apiUrl);

        this.fetchJSON(apiUrl, { timeout: this.config.timeout || 15_000 }).then(async (response) => {
            this.log.debug(5, "%1 [postCommandAsync] %2", this, response);

            // todo: integrate handleResponse
            if (response.result == 1)
                this.updateEntityAttributes(e, attributes);
        }).catch(async err => {
            this.log.err("%1 [postCommandAsync] error: %2", this, err);

            // retry logic
            if (failures < max_retries) {
                await delay(Math.min(2_000, (this.config.error_interval || 5_000) * Math.max(1, ++failures - 12)));

                postCommandAsync(url, params, e, attributes, failures);
            }
        });
    }

    /* handle incoming messages from MQTT broker */
    onMqttMessage(topic, value) {
        this.log.notice("%1 [onMqttMessage] %2: %3", this, topic, value);

        // opensprinkler/availability: online/offline
        // opensprinkler/system: this topic receives {"state":"started"} message when the controller boots.
        // opensprinkler/station/x: where x is the index (starting from 0) of the station/zone. For example, the first zone is 0, the second zone is 1 and so on.
        //   This topic receives {"state":1} message when station/zone x starts running, and {"state":0,"duration":ss} message when the zone finishes running, 
        //   where ss is the number of seconds that it ran. To receive data for all stations, you can subscribe to wildcard topic opensprinkler/station/#
        // opensprinkler/sensor1: this topic receives {"state":1} when sensor 1 activates and {"state":0} when sensor 1 deactivates.
        // opensprinkler/sensor2: similar to above but for sensor 2.
        // opensprinkler/raindelay: similar to above but for rain delay.
        // opensprinkler/sensor/flow: this topic receives {"count":cc,"volume":vv} when the flow sensor generates data (usually when a zone finishes running), where cc 
        //   is the flow count, and vv is the amount of volume.

        var needsRefresh = false;
        var attributes;
        var e;

        if (topic == "opensprinkler/availability") {
            this.log.notice("%1 [onMqttMessage] availability: %2", this, value);
            if (value == "online") {
                needsRefresh = true;
                //this.online();
            }
            else
                this.offline();
        }
        else if (topic.startsWith("opensprinkler/station/")) {
            var json = JSON.parse(value);
            var id = parseInt(topic.split('/')[2]);
            var state = json?.state == "1";
            var duration = json?.duration ?? 0;

            this.log.notice("%1 [onMqttMessage] station: %2, %3, %4", this, id, state, duration);

            e = this.findEntity(`os_station_${id + 1}`);

            attributes = {
                "irrigation_zone.state": state,
                "power_switch.state": state,
                "toggle.state": state,
                "irrigation_zone.duration": duration,
            };

            if (!state) {
                attributes["irrigation_zone.remaining"] = 0;
                attributes["irrigation_zone.last_run"] = Math.floor(new Date() / 1000) - duration;
            }
        }
        else if (
            topic == "opensprinkler/raindelay" ||
            topic == "opensprinkler/sensor1" ||
            topic == "opensprinkler/sensor2"
        ) {
            var id = topic == "opensprinkler/sensor1" ? "os_sensor1" :
                topic == "opensprinkler/sensor1" ? "os_sensor2" :
                    "os_raindelay";

            var json = JSON.parse(value);
            var state = json?.state == "1";

            this.log.notice("%1 [onMqttMessage] sensor: %2, %3", this, id, state);

            e = this.findEntity(id);
            attributes = {
                "binary_sensor.value": state,
                "power_switch.state": state,
                "toggle.state": state
            };

            if (topic == "opensprinkler/raindelay") {
                // mqtt messages does not contain duration: a refresh is needed
                needsRefresh = true;
            }
        }
        else {
            this.log.notice("%1 [onMqttMessage] message ignored: %2, %3", this, topic, value);
        }

        // update attributes
        this.updateEntityAttributes(e, attributes);

        // OS mqtt message are very limited, so we need to request a refresh from API to sync everything
        if (needsRefresh)
            this.refreshStatus();
    }

    /* Maps a device into a MSR entity */
    mapSensorDevice(id, status, sensorType, sensorOptions) {
        if (sensorType > 0) {
            /*
            ● sn1t: Sensor 1 type. (0: not using sensor; 1: rain sensor; 2: flow sensor; 3: soil sensor; 240 (i.e. 0xF0): program switch).
            ● sn1o: Sensor 1 option. (0: normally closed; 1: normally open). Default is normally open.
            ● sn1on/sn1of: Sensor 1 delayed on time and delayed off time (unit is minutes).
            ● sn2t/sn2o: Sensor 2 type and sensor 2 option (similar to sn1t and sn1o, for OS 3.0 only).
            */
            this.mapDevice(`os_sensor${id}`,
                sensorType == 3 ? "Soil Sensor" : sensorType == 1 ? "Rain Sensor" : sensorType == 2 ? "Flow Sensor" : sensorType == 240 ? "Program Switch" : `Sensor ${id}`,
                ["binary_sensor", ns], "binary_sensor.state",
                {
                    "binary_sensor.state": (status || 0) == sensorOptions,
                    "_ns_.type": "sensor",
                });
        }
    }

    /* Maps a device into a MSR entity */
    mapDevice(id, name, capabilities, defaultAttribute, attributes) {
        this.log.debug(5, "%1 mapDevice(%2, %3, %4, %5, %6)", this, id, name, capabilities, defaultAttribute, attributes);

        let e = this.findEntity(id);

        try {
            if (!e) {
                this.log.notice("%1 Creating new entity for %2", this, name);
                e = this.getEntity(className, id);
                e.setName(name);
                e.setType(className);
            }
            // else {
            //     e.setName(name);
            //     e.setType(className);
            // }

            e.deferNotifies(true);
            e.markDead(false);

            // capabilities
            if (capabilities) {
                this.log.debug(5, "%1 [%2] adding capabilities: %3", this, id, capabilities);
                capabilities.forEach(c => {
                    if (!e.hasCapability(c)) {
                        this.log.debug(5, "%1 [%2] adding capability %3", this, id, c);
                        e.extendCapability(c);
                    }
                });
            }

            this.updateEntityAttributes(e, attributes);

            if (defaultAttribute)
                e.setPrimaryAttribute(defaultAttribute);

            // extended capabilities
            // e.extendCapability(ns);
            // Object.keys(vars).forEach(v => {
            //     e.setAttribute(`{ns}.${v.replace(".", "_")}`, vars[v]);
            // });
        } catch (err) {
            this.log.err("%1 [mapDevice] error: %2", this, err);
        } finally {
            e.deferNotifies(false);
        }
    }

    updateEntityAttributes(e, attributes) {
        if (e && attributes) {
            var id = e.getCanonicalID();

            for (const attr in attributes) {
                var newValue = attributes[attr];

                // skip ignored values
                if (ignoredValue != newValue) {
                    // check if value has changed
                    var attrName = attr.replace(/_ns_/g, ns);
                    var value = e.getAttribute(attrName);

                    // check for and skip unchanged values
                    var changed = value != newValue && JSON.stringify(value) != JSON.stringify(newValue);
                    if (changed) {
                        this.log.notice("%1 [%2] %3: %4 => %5", this, id, attrName, newValue, value);
                        e.setAttribute(attrName, newValue);
                    }
                }
            };
        }
    }

    composeUrl(url) {
        return `http://${this.config.host}/${url}&pw=${this.config.password}`;
    }

    // https://github.com/OpenSprinkler/OpenSprinkler-App/blob/6116c514cbf3a5f25613ab6dbad8ddafc00ceec1/www/js/main.js#L10854
    getHardwareVersion(hwv, hwt) {
        if (typeof hwv === 'string') {
            return hwv;
        } else {
            switch (hwv) {
                case 64:
                    return 'OSPi';
                case 128:
                    return 'OSBo';
                case 192:
                    return 'Linux';
                case 255:
                    return 'Demo';
                default:
                    return 'OS ' + (((hwv / 10) >> 0) % 10) + '.' + (hwv % 10) + this.getHWType(hwt);
            }
        }
    }

    getHWType(hwt) {
        if (typeof hwt !== "number" || hwt === 0) {
            return "";
        }

        if (hwt === 172) {
            return " - AC";
        } else if (hwt === 220) {
            return " - DC";
        } else if (hwt === 26) {
            return " - Latching";
        } else {
            return "";
        }
    }

};