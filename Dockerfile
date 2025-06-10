FROM node:22-alpine

# Crear directorio de trabajo
WORKDIR /home/node/app

# Instalar dependencias necesarias
RUN apk add --no-cache wget

# Copiar archivos de la app
COPY . /home/node/app

# Instalar dependencias
RUN npm install

CMD node main.js
