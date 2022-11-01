# reactor-opensprinkler
OpenSprinkler Controller for Reactor - Multi-Hub Automation.

## Installation
OpenSprinkler Controller must be installed separately. Just download all the files from this repo.

Create, if it does not already exist, a directory called *ext* in your Reactor install directory (so it should be at the same level as config, storage, etc.).

```
cd /path/to/reactor
mkdir ext
```

If you are running Reactor in a docker container, the *ext* directory should be created in the data directory, where your config and storage directories live as indicated above.

Change directory into the new *ext* directory:

```
cd ext
```

Copy all the files.
Run the install script. If you are using a "bare metal" install (not a docker container):

```
cd OpenSprinklerController
./install.sh
```

If you are running Reactor in a docker container, we will open a container shell in which to do the install (the Reactor container must be up and running):

```
docker exec -it <container-name> /bin/sh
cd /var/reactor/ext/OpenSprinklerController
./install.sh
exit
```

From here, proceed to Basic Configuration below.

## Basic Configuration

In order to use OpenSprinklerController, you have to add an entry for it to the controllers section of your *reactor.yaml* file.

```
controllers:
  # Your existing controllers will be below the above line.
  # Add the following after the last "- id" line in this
  # section.
  - id: opensprinkler
    name: OpenSprinkler
    implementation: OpenSprinklerController
    enabled: true
    config:
      # Replace the IP with that of your OpenSprinkler host below.
      host: "192.168.1.41"

      # default hash for opendoor
      password: "a6d82bced638de3def1e9bbb4983225c"

      # interval for refresh: default 5 secs
      #interval: 5000

      # timeout: default 15 secs
      #timeout: 15000

      # error_interval: default 10 secs
      #error_interval: 10000

      # default_zone_duration: default 60 secs
      #default_zone_duration: 60

      # default_raindelay_duration: default 1 hour
      #default_raindelay_duration: 1
```

Restart Reactor to make the changes take effect. After that, you should be able to refresh the UI, go the Entities list, clear any existing filters, and choose "OpenSprinkler" from the controllers filter selector. That should then show you two entities: the MQTT controller system entity, and its default group entity. If you don't see this, check the log for errors.

## Capabilities

At the moment, you can:
 - operate zones and programs
 - enable/disable the controller (via power_switch)
 - enable/disable programs and zones
 - see rain delay
 - set rain delay programmatically (ie: from your own rain sensors/weather station)
 - see water level
 - see additional sensors status (if present)
 - set rain delay to a personalized amount of hours (added in 20221101)

On my TODO list:
 - get programs status in a reliable way (WIP)
 - handle missing actions from irrigation_zone (?)
 - move programs from irrigation_zone to a custom capability (?)
 - if MQTT is configured, prefer it to polling (WIP)

## Support

This is beta software, so expect quirks and bugs. Support is provided via https://smarthome.community/.