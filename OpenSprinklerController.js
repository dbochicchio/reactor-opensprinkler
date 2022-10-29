/** A Reactor controller for OpenSprinkler.
 *  Copyright (c) 2022 Daniele Bochicchio, All Rights Reserved.
 *  OpenSprinklerController is offered under MIT License - https://mit-license.org/
 *  More info: https://github.com/dbochicchio/reactor-opensprinkler
 *
 *  Disclaimer: Thi is beta software, so quirks anb bugs are expected. Please report back.
 */

const version = 22283;
const className = "opensprinkler";
const ns = "x_opensprinkler"
const ignoredValue = "@@IGNORED@@"

const Controller = require("server/lib/Controller");

const Logger = require("server/lib/Logger");
Logger.getLogger('OpenSprinklerController', 'Controller').always("Module OpenSprinklerController v%1", version);

const Configuration = require("server/lib/Configuration");
const logsdir = Configuration.getConfig("reactor.logsdir");  /* logs directory path if you need it */

const Capabilities = require("server/lib/Capabilities");

// modules
const util = require("server/lib/util");

//const mqtt = require('mqtt');
//const { hostname, EOL } = require('os');

const delay = ms => new Promise(res => setTimeout(res, ms));

var impl = false;  /* Implementation data, one copy for all instances, will be loaded by start() later */

module.exports = class OpenSprinklerController extends Controller {
    constructor(struct, id, config) {
        super(struct, id, config);  /* required *this.*/

        this.failures = 0;

        this.stopping = false;       /* Flag indicates we're stopping */

        this.pending = new Map();   /* Pending requests (keys are integer, values are TimedPromise) */
    }

    /** Start the controller. */
    async start() {
        if (!this.config.host) {
            return Promise.reject("No host configured");
        }

        if (!this.config.password) {
            return Promise.reject("No password configured");
        }

        /** Load implementation data if not yet loaded. Remove this if you don't
         *  use implementation data files.
         */
        if (false === impl) {
            impl = await this.loadBaseImplementationData(className, __dirname);
        }

        // custom capabilities
        if (!Capabilities.getCapability(ns)) {
            this.log.notice("%1 registering capability: %2", this, ns);
            Capabilities.loadCapabilityData({
                "x_opensprinkler": {
                    "attributes": {},
                    "actions": {}
                }
            });
        }

        this.log.debug(5, "%1 starting", this);

        // TODO: connect to and monitor mqtt broker

        this.stopping = false;
        this.run();

        return this;
    }

    /* Stop the controller. */
    async stop() {
        this.log.notice("%1 stopping", this);
        this.stopping = true;

        /* Required ending */
        return await super.stop();
    }

    /* run() is called when Controller's single-simple timer expires. */
    run() {
        this.log.debug(5, "%1 running", this);

        return new Promise(resolve => {
            this.refreshStatus();

            resolve(this);
        });
    }

    /* performOnEntity() is used to implement actions on entities */
    async performOnEntity(entity, actionName, params) {
        this.log.notice("%1 perform %2 on %3 with %4", this, actionName, entity, params);

        switch (actionName) {
            // irrigation
            case 'irrigation_zone.run':
                return await this.switchEntityAsync(entity, true);
            case 'irrigation_zone.stop':
                return await this.switchEntityAsync(entity, false);
            case 'irrigation_zone.enable':
                return await this.enableEntityAsync(entity, true);
            case 'irrigation_zone.disable':
                return await this.enableEntityAsync(entity, false);
            case 'irrigation_zone.set':
                return await this.switchEntityAsync(entity, params.state, params.duration);
            // power_switch
            case 'power_switch.on':
                return await this.switchEntityAsync(entity, true);
            case 'power_switch.off':
                return await this.switchEntityAsync(entity, false);
            case 'power_switch.set':
                return await this.switchEntityAsync(entity, params.state);
            // toggle
            case 'toggle.toggle':
                return await this.switchEntityAsync(entity);
            default:
                return super.performOnEntity(entity, actionName, params);
        }
    }

    async enableEntityAsync(e, state) {
        // TODO
    }

    async switchEntityAsync(e, state, duration) {
        this.log.notice("%1 switchEntityAsync(%2, %3, %4)", this, e, state, duration);

        var defaultDuration = 60;

        // we're using power_switch.state since it's shared with controller
        var currentState = e.getAttribute('power_switch.state');

        // toggle
        if (state == undefined) {
            this.log.debug(5, "%1 currentState: %2", this, currentState);
            state = !currentState;
        }

        var isZone = e.getAttribute(`${ns}.type`) == "zone";
        var isProgram = e.getAttribute(`${ns}.type`) == "program";
        var isController = e.getAttribute(`${ns}.type`) == "controller";
        var isRainDelay = e.getAttribute(`${ns}.type`) == "raindelay";

        var id = e.getAttribute(`${ns}.id`) || '-1';
        var attributes = {};
        var command;
        var cmdParams = {
            "en": state ? "1" : "0",	                    // enable flag
            "t": state ? duration || defaultDuration : 0,   // timeout, for programs only
            "sid": id,	                          	        // station id, for stations
            "pid": id,          	                        // program id, for programs
            "uwt": 0		            			        // use weather adjustment
        };

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

            command = "cm";
            attributes = {
                "irrigation_zone.state": state,
                "power_switch.state": state,
                "toggle.state": state,
                "irrigation_zone.remaining": state ? duration || defaultDuration : 0
            };
        }
        else if (isProgram) {
            command = "mp";
            attributes = {
                "irrigation_zone.state": state,
                "power_switch.state": state,
                "toggle.state": state,
                "irrigation_zone.remaining": state ? duration || defaultDuration : 0
            };
        }
        else if (isRainDelay) {
            var rdHours = 1; // TODO: params
            cmdParams = {
                "rd": state ? rdHours : 0, // rain delay in hours
            };
            command = "cv"; // change variables command to enable/disable controller

            var rdDate = new Date().getTime() + rdHours * 60 * 60 /** 1000*/;
            attributes = {
                "binary_sensor.value": state,
                "power_switch.state": state,
                "toggle.state": state,
                "string_sensor.value": state ? rdDate : 0,
            };
		}

        if (command) {
            await this.postCommandAsync(command, cmdParams, e, attributes);
        }
        else {
            this.log.err("%1 [switchEntityAsync] error: %2 - %3 - %4", this, e, state, duration);
        }
    }

    async postCommandAsync(url, params, e, attributes) {
        var qs = "?";
        for (const p in params) {
            qs += `${p}=${params[p]}&`;
        };

        var failures = 0;
        const apiUrl = this.composeUrl(url + qs);
        this.log.info("%1 connecting to %2", this, apiUrl);
        this.fetchJSON(apiUrl, { timeout: this.config.timeout || 15_000 }).then(async (response) => {
            this.log.debug(5, "%1 replied with %2", this, response);
            failures = 0;

            // TODO: parse response, check for errors and notifies UI?
            for (const attr in attributes) {
                var attrName = attr.replace(/_ns_/g, ns);

                // check if value has changed
                var value = e.getAttribute(attrName);
                if (value != attributes[attr]) {
                    this.log.debug(5, "%1 [%2] setting attribute %3 to %4", this, e.id, attrName, attributes[attr]);
                    e.setAttribute(attrName, attributes[attr]);
                }
            };
        }).catch(async err => {
            this.log.err("%1 [postCommandAsync] error: %2", this, err);
            await delay(Math.min(2_000, (this.config.error_interval || 10_000) * Math.max(0, ++failures - 12)));

            // try 3 times, then
            if (failures > 3) {
                return;
            }
        });
    }

    /* refreshStatus() load status and creates the entities */
    refreshStatus() {
        if (this.stopping) return;

        const apiUrl = this.composeUrl("ja?");
        this.log.notice("%1 connecting to %2", this, apiUrl);
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

                    this.log.notice("%1 Program #%2: %3", this, index, state);

                    // https://github.com/OpenSprinkler/OpenSprinkler-App/blob/6116c514cbf3a5f25613ab6dbad8ddafc00ceec1/www/js/main.js#L8408
                    this.mapDevice(id, pd[5] || `Program #${index + 1}`,
                        ["irrigation_zone", "power_switch", "toggle", ns], "irrigation_zone.state", {
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
            this.mapDevice("os_raindelay", "Rain Delay", ["binary_sensor", "power_switch", "toggle", "string_sensor", ns], "binary_sensor.state", {
                "binary_sensor.state": rdState,
                "power_switch.state": rdState,
                "toggle.state": rdState,
                "string_sensor.value": response.settings.rdst,
                "_ns_.type": "raindelay"
            });

            /*● sn1t: Sensor 1 type. (0: not using sensor; 1: rain sensor; 2: flow sensor; 3: soil sensor; 240 (i.e. 0xF0): program switch).
              ● sn1o: Sensor 1 option. (0: normally closed; 1: normally open). Default is normally open.
                (note the previous urs and rso options are replaced by sn1t and sn1o)
               ● sn1on/sn1of: Sensor 1 delayed on time and delayed off time (unit is minutes).
               ● sn2t/sn2o: Sensor 2 type and sensor 2 option (similar to sn1t and sn1o, for OS 3.0 only).
            */
            this.mapDevice("os_sensor1", "Sensor 1", ["binary_sensor", ns], "binary_sensor.state", {
                "binary_sensor.state": (response?.settings?.sn1 || 0) == 1,
                "_ns_.type": "sensor",
            });

            this.mapDevice("os_sensor2", "Sensor 2", ["binary_sensor", ns], "binary_sensor.state", {
                "binary_sensor.state": (response?.settings?.sn2 || 0) == 1,
                "_ns_.type": "sensor",
            });

            this.mapDevice("os_waterlevel", "Water Level", ["string_sensor", ns], "string_sensor.value", {
                "string_sensor.value": response?.options?.wl || 0,
                "string_sensor.units": "%",
                "_ns_.type": "waterlevel",
            });

            // controller status
            this.mapDevice("system", 'Open Sprinkler', ["power_switch", "toggle", "string_sensor", ns], "string_sensor.value", {
                "power_switch.state": (response?.settings?.en || response?.options?.den == 0) == 1,
                "toggle.state": (response?.settings?.en || response?.options?.den == 0) == 1,
                "string_sensor.value": (response?.settings?.en || response?.options?.den == 0) == 1 ? "Enabled" : "Disabled",
                "_ns_.type": "controller",
                "_ns_.hardwareVersion": this.getHardwareVersion(response?.options?.hwv),
                "_ns_.rssi": (response?.settings?.RSSI),
                "_ns_.firmwareversion": (response?.options?.fwv || '0'),
                "_ns_.lastboot": (response?.settings?.lupt || 0),
                "_ns_.lastbootreason": (response?.settings?.lrbtc || 0),
                "_ns_.lastrun": (response?.settings?.lrun) // lrun: Last run record, which stores the [station index, program index, duration, end time] of the last run station.
            });

            this.online();
            this.startDelay(this.config.interval || 10_000);
        }).catch(err => {
            this.log.err("%1 [refreshStatus] error: %2", this, err);
            this.startDelay(Math.min(120_000, (this.config.error_interval || 10_000) * Math.max(0, ++this.failures - 12)));

            if (this.failures >= 3) {
                this.offline();

                e.setAttributes({
                    reachable: false,
                    error: true,
                    message: `${this.config.source} ${String(err)}`
                }, ns);
            }
        });
    }

    /* Maps a device into a MSR entity */
    mapDevice(id, name, capabilities, defaultAttribute, attributes) {
        this.log.debug(5, "%1 mapDevice(%2, %3, %4, %5, %6)", this, id, name, capabilities, defaultAttribute, attributes);

        let e = this.findEntity(id);

        try {
            if (!e) {
                this.log.notice("%1 Creating new entity for %2", this, name);
                e = this.getEntity(className, id);
            }
            else {
                e.setName(name);
                e.setType(className);
            }

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

            if (attributes) {
                for (const attr in attributes) {
                    // check for and skip ignored values
                    if (ignoredValue != attributes[attr]) {
                        // check if value has changed
                        var attrName = attr.replace(/_ns_/g, ns);
                        var value = e.getAttribute(attrName);
                        if (value != attributes[attr]) {
                            this.log.notice("%1 [%2] %3: %4 => %5", this, id, attrName, attributes[attr], value);
                            e.setAttribute(attrName, attributes[attr]);
                        }
                    }
                };
            }

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

    composeUrl(url) {
        return `http://${this.config.host}/${url}&pw=${this.config.password}`;
    }

    // https://github.com/OpenSprinkler/OpenSprinkler-App/blob/6116c514cbf3a5f25613ab6dbad8ddafc00ceec1/www/js/main.js#L10854
    getHardwareVersion(rawHardwareVersion) {
        if (typeof rawHardwareVersion === 'string') {
            return rawHardwareVersion;
        } else {
            switch (rawHardwareVersion) {
                case 64:
                    return 'OSPi';
                case 128:
                    return 'OSBo';
                case 192:
                    return 'Linux';
                case 255:
                    return 'Demo';
                default:
                    return (((rawHardwareVersion / 10) >> 0) % 10) + '.' + (rawHardwareVersion % 10);
            }
        }
    }
};