---
title: Local setup in minutes
authors: pardahlman
tags: [development-environment]
---

_TL;DR this is a [Docker](https://www.docker.com/) love story. Why spend hours setting up your development environment, when it can be done with a single command? Sort of, anyways._

A couple of months ago, I bought a new PC for .NET development on Windows. Little did I know that it was shipped with a damaged disk that decided to give up only weeks after I had set up my local development environment. By that time, I had installed Erlang, RabbitMQ, Elastic, Kibana, MongoDB, SQL Server and a few other applications I needed.

<!-- truncate -->

It always annoys me when I install Elastic that I also need to install Java, which for some reason never gets added to the `PATH` correctly so I need to fumble around with `JAVA_HOME` directories for a while before I get it right. Also, that command to set up Windows services, `sc`... something? And the space between the equal sign and the argument value. It is something that I need to look up before I get it right.

> Also, that command to set up Windows services, sc… something?

On a MacBook, I would use something like [Brew](https://brew.sh/), but the Windows alternative, [Chocolatey](https://chocolatey.org/), and I have had our differences. To sum it up, hours of work put in to setup the machine _just the way I wanted_, followed by hardware failure. [Sisyphus](https://en.wikipedia.org/wiki/Sisyphus), all over again!

A technician drove out to my office the following day and replaced not only the disk, but the motherboard and the docking station as well. Later that evening, I stayed up to re-do my setup again. The following day, when I docked my computer the docking station didn't recognize my keyboard, mouse and ethernet connection. Customer service told me that the best course of action would be to re-install Windows all-together.

Up until that point, my local development environment had been something that I had to deal with only when I bought a new computer, which isn't that often. Three times within a few months got me thinking. I decided to evaluate how [Docker](https://www.docker.com/) could be used to set up my Windows development environment.

## Docker... on Windows?

Docker has been around on Linux for ages (or at least four years), but it is still relatively new for Windows. The [first alpha](https://docs.docker.com/docker-for-windows/release-notes/#alpha-0-release-2016-02-09-11000-0) was released in the beginning of 2016 and went through over 41 beta releases and 1 release candidate until the [first stable version](https://docs.docker.com/docker-for-windows/release-notes/#docker-for-windows-1120-2016-07-28-stable) was released that summer. It is currently only supported on the latest versions of Windows, that is [Windows 10 Pro](https://docs.docker.com/docker-for-windows/install/#download-docker-for-windows) and [Windows Server 2016](https://www.docker.com/docker-windows-server).

Behind the scene, Docker uses Hyper-V to create a virtual Linux Alpine machine that acts as the docker host and is responsible for containers. This means that all Linux based docker containers are available even though the host OS is Windows. (_There are also [Windows containers](https://www.docker.com/microsoft), more about them another day._)

## Why Docker Compose?

The [docker-compose](https://docs.docker.com/compose/) command creates containers as described in `docker-compose.yml`. Some of the features of compose makes it ideal for local setup.

### High readability

There are lots of docker images that works with a simple `docker run` command, no additional parameters required. In order to be productive, perhaps have access to logs on the host, custom service configuration ect the number of commands just increases until it's just one long line of parameters that is difficult to get an overview of.

The compose file, on the other hand is written in [YAML](http://yaml.org/) and as such requires [correct indentation](http://www.yaml.org/spec/current.html#id2438272). Here's an example of how RabbitMQ might be declared

```yml
rabbitmq:
  image: 'library/rabbitmq:3-management'
  ports:
    - 15672:15672
    - 5672:5672
  volumes:
    - rabbitmq:/var/lib/rabbitmq/
  hostname: docker
```

Which just is more readable than the command line alternative

```
docker run -d --hostname docker -p 15672:15672 -p 15672:15672 -v rabbitmq:/var/lib/rabbitmq/ library/rabbitmq:3-management
```
We'll get back to the volume mapping in a bit.

### Service Discovery

For my local setup, I use [Elastic Search](https://www.elastic.co/products/elasticsearch) and [Kibana](https://www.elastic.co/products/kibana) for [log aggregation](./2017-01-25-making-sense-of-all-those-logs/index.md). Kibana needs to be able to pull the log entries from Elastic Search. This is where [docker compose's networking features](https://docs.docker.com/compose/networking/) come to play. Docker compose creates a single network and adds DNS entries for each declared service, making them reachable though the name of the container. Here's how I define Elastic Search

```yaml
elasticsearch:
  image: 'library/elasticsearch:5'
  ports:
    - 9200:9200
```

It is no coincidence that I picked `elasticsearch` as a service name, it is the [default elastic host](https://github.com/docker-library/kibana/blob/69daf8cf674823df85e2d48489d5c26f1c2f7d8a/5/Dockerfile#L63) for the Kibana container. This allows Kibana to find Elastic Search without any additional configuration

```yaml
kibana:
  image: 'library/kibana:5'
  ports:
    - 5601:5601
  depends_on:
    - elasticsearch
```

The `depends_on` will make sure that the elasic container will be started before Kibana. However, it does not guarantee that the elasic service will be up and running before the container is created. In the scenario with Kibana, it doesn't really matter, but if it is important that a service is running before a container is started, something like [wait-for-it](https://github.com/vishnubob/wait-for-it) can be used.

### Easier commands

Strictly speaking, Kibana is the only service in my local setup that leverages the service discovery feature. I find it very easy to start everything up with one command

```
> docker-compose up
```

In addition to this, containers can be start and stoped simply by referring to them by their service name (instead of container id, which is how it is done when using the `docker` command). Shutting down the RabbitMQ service can be done through this command

```
> docker-compose stop rabbitmq
```

The same is true for many of of the normal docker commands, like `log` and  `exec`.

## Understanding volumes

Any data that is created within a container will by default be removed when the container is removed. While this makes sense, it is not always the most desired behavior. For my local setup, I might want to remove a MongoDB container to start a new one with the latest version. This is where volume and volume mapping comes into play.

Something that I didn't realize at first, was that when I run `docker-compose down` it does not only stop and remove the containers running, but related volumes. In order to not accidentally remove all data I've persisted, I created the volumes outside of docker-compose and reference them as [external](https://docs.docker.com/compose/compose-file/#external).

```
volumes:
  mongodata:
    external: true
```

The volume is then mapped to some directory in the container.

```
mongodb:
  image: 'library/mongo:3'
  volumes:
    - mongodata:/data/db
  ports:
    - 27017:27017
```

The data stored in the containers db path will now be stored in the `mongodata` volume that lives outside of the container.

## Summary

Docker is a powerful technology, and judging from how everyone is talking about it, it's here to stay. Using it in local setup makes tons of sense, as it not only help install service dependencies (like a certain version of java), but also encapsulate them in containers that can be removed without any trace left on your computer.

I've created a [Github repo](https://github.com/pardahlman/docker-infrastructure) with the services I currently run from Docker. Knock yourself out!
