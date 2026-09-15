# Shared names for the Docker helper scripts.
#
# One definition, two consumers. In v2 docker-build.sh created a container
# called swiss_app_local while docker-cleanup.sh stopped swiss_app, so
# cleanup always failed after a build.
IMAGE_NAME="${IMAGE_NAME:-swiss-on-fhir}"
CONTAINER_NAME="${CONTAINER_NAME:-swiss_app}"
HOST_PORT="${HOST_PORT:-4200}"
