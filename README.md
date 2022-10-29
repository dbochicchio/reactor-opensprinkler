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
    interface: OpenSprinklerController
    enabled: true
    config:
      # Replace the IP with that of your OpenSprinkler host below.
      host: "192.168.1.42"

      # default hash for opendoor
      password: "a6d82bced638de3def1e9bbb4983225c"

      # interval for refresh: default 5 secs
      # interval: 5000

      # timeout: default 15 secs
      # timeout: 15000

      # error_interval: default 10 secs
      # error_interval: 10000
```

Restart Reactor to make the changes take effect. After that, you should be able to refresh the UI, go the Entities list, clear any existing filters, and choose "OpenSprinkler" from the controllers filter selector. That should then show you two entities: the MQTT controller system entity, and its default group entity. If you don't see this, check the log for errors.

## Capabilities

At the moment, you can:
 - enable/disable the controller (via power_switch)
 - see water level
 - see water delay
 - see sensors status
 - set rain delay programmatically (ie: from your own rain sensors/weather station)
 - operate zones and programs

On my TODO list:
 - enable/disable zones (programs are ok)
 - set rain delay to a personalized amount of hours (it's fixed to one hour)
 - get program state in a reliable way
 - handle missing actions (?)
 - move programs from irrigation_zone to a custom capability (?)

## Support

This is beta software, so expect quirks and bugs. Support is provided via https://smarthome.community/.