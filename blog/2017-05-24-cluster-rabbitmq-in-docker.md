---
title: Cluster RabbitMQ in Docker
authors: [pardahlman]
tags: [development-environment]
---

[Docker](http://docker.com/) is the kind of technology that grows on you. A couple of months I barely knew the difference between a container and image, but lately I've been exploring the benefits of using docker to spin up my [local development environment](./2017-05-21-local-setup-in-minutes-with-docker.md) and it is impressive how easy it is to getting started.

In this post, I describe how I created [this Github repo](https://github.com/pardahlman/docker-rabbitmq-cluster), that clusters three RabbitMQ servers without building any custom images for it.

<!-- truncate -->

## RabbitMQ in Docker

As the author of [RawRabbit](https://github.com/pardahlman/RawRabbit), I have a vested interest in [RabbitMQ](http://rabbitmq.com/). Up until this point, I've been using a single, local instance for my development. It works fine for most tasks, but it isn't optimal when looking into [high availability](https://www.rabbitmq.com/ha.html) setups with [clustered brokers](https://www.rabbitmq.com/clustering.html), which is the de facto way to run it in production environments. Luckily, this kind of scenario is what docker is made for docker.

## How to cluster 'em?

There are [tons of images](https://hub.docker.com/search/?isAutomated=0&isOfficial=0&page=1&pullCount=0&q=rabbitmq+cluster&starCount=0) at Docker Hub for clustering RabbitMQ. As I started to look through the list, though, I realized that most of the images haven't been updated for quite some time. The most reason cluster image I found was lagging months behind.

There is one image that is kept up to date: [the official one](https://hub.docker.com/r/_/rabbitmq/)[^1]. It is maintained by the docker community and is a pretty safe bet for future releases. What if I could create a RabbitMQ cluster based on this image? Challenge accepted!

## Spinning up individual containers

It's easy enough to spin up three separate RabbitMQ nodes, all running side by side.

```docker
version: '3'

services:
  rabbitmq1:
    image: rabbitmq:3-management
  rabbitmq2:
    image: rabbitmq:3-management
  rabbitmq3:
    image: rabbitmq:3-management
```

In order for nodes to be able to cluster, they must share the same secret stored in the `.erlanng.cookie`. Luckily for me, it can be set to the docker container through the environment variable `RABBITMQ_ERLANG_COOKIE`. For convenience, I added the cookie value in the compose [environment file](https://docs.docker.com/compose/environment-variables/#the-env-file), and referenced it to the containers through that value

```docker
environment:
  - RABBITMQ_ERLANG_COOKIE=${RABBITMQ_ERLANG_COOKIE}
```

That's it. The containers should be able to cluster. The only question is: how should this be done?

## Clustering the containers

The fact that I didn't want to build a new image narrowed down the options. My first idea was to have a bash script that could be run after `docker-compose up` that invoked the `rabbitmqctl` commands necessary to cluster. However, I decided that it would be worth adding some complexity to the compose file if it meant that it could handle the clustering too.

What I decided on was to mount a volume that contained a "cluster entry point", with the following lines of code


```sh
/usr/local/bin/docker-entrypoint.sh rabbitmq-server -detached
rabbitmqctl stop_app
rabbitmqctl join_cluster rabbit@rabbitmq1
rabbitmqctl stop
sleep 2s
rabbitmq-server
```

Let's go through them one at a time

* The first line uses the official [entry point](https://github.com/docker-library/rabbitmq/blob/1509b142f0b858bb9d8521397f34229cd3027c1e/3.6/debian/Dockerfile#L89) and is called with [same argument](https://github.com/docker-library/rabbitmq/blob/1509b142f0b858bb9d8521397f34229cd3027c1e/3.6/debian/Dockerfile#L92) as the official image. This ensures that the environment variables described at Docker Hub will be honored. It is run with the detached flag, so that it runs in the background.
* `rabbitmqctl stop_app` is the first part of the cluster dance. It is described in depth [here](https://www.rabbitmq.com/clustering.html).
* Joining the cluster. I know that the first RabbitMQ broker can be reached at `rabbitmq1`, since this is the name of the container.
* `rabbitmqctl stop` stops the entire RabbitMQ Server. I do this, because I want to run it in the forground, so that the logs are captured to the container
* The stop command returns before the server is actually stopped. Adding 2 seconds wait for good measure-width
* Starting the server again with `rabbitmq-server`. This time, I don't need to call it through the entry point, as all configuration was already done the first time.

The only thing left to do, was updating `docker-compose.yml` to mount the script and use it as an entry point for all but the first RabbitMQ container.

```docker
volumes:
  - ./cluster-entrypoint.sh:/usr/local/bin/cluster-entrypoint.sh
entrypoint: /usr/local/bin/cluster-entrypoint.sh
```

## Exposing the cluster on localhost

RabbitMQ communicates over port 5672 by default, and I wanted the cluster to use that port, too. I therefore added [HA Proxy](http://www.haproxy.org/), an open source software that provides a high availability load balancer and proxy server in front of the cluster.

The proxy round robins between the different hosts in the cluster and performs checks to make sure that the traffic is directed to an active node.

I haven't evaluated the benefits with the load balancer yet, but with this setup, I will be able to try different clusters approaches without any effort.

### Try for yourself

As I said at the top: the source code for this can be found [at Github](https://github.com/pardahlman/docker-rabbitmq-cluster). Try it out and tell me what you think.

Happy coding!

#### Footnotes
[^1]: Referring to the [Official repositories on Docker Hub](https://docs.docker.com/docker-hub/official_repos/), curated by Docker.
