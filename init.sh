#!/bin/sh

export CF_TOKEN=$(awk '{print $NF}' cmd.txt)

docker compose down --rmi all

docker compose build

docker compose up -d
