#!/bin/sh

docker compose down --rmi all

docker compose build

docker compose up -d
