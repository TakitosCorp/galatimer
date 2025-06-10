FROM node:22-alpine

# Crear directorio de trabajo
WORKDIR /home/node/app

# Copiar archivos del proyecto
COPY . /home/node/app

# Instalar dependencias
RUN npm install

# Comando para iniciar la app
CMD ["node", "copitas.js"]
