FROM python:3.12-slim
WORKDIR /code

# Docker CLI only. The backend uses it to ask the (host) daemon for a throwaway
# sandbox container; the daemon itself is never installed in this image.
ARG DOCKER_CLI_VERSION=27.3.1
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI_VERSION}.tgz" \
      | tar xz --strip-components=1 -C /usr/local/bin docker/docker \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
