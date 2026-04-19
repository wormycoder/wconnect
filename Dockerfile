FROM nginx:alpine

# Copy all site files to nginx's web root
COPY . /app

# Copy our nginx config
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 8080
