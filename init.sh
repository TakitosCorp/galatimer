#!/bin/sh

# Borrar la imagen vieja de Docker
docker compose down --rmi all

# Compilar la imagen de Docker
docker compose build

# Iniciar los contenedores en segundo plano
docker compose up -d
