#!/bin/bash
#
# // Copyright 2021 Omar Hoblos
# //
# // Licensed under the Apache License, Version 2.0 (the "License");
# // you may not use this file except in compliance with the License.
# // You may obtain a copy of the License at
# //
# //     http://www.apache.org/licenses/LICENSE-2.0
# //
# // Unless required by applicable law or agreed to in writing, software
# // distributed under the License is distributed on an "AS IS" BASIS,
# // WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# // See the License for the specific language governing permissions and
# // limitations under the License.
#

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${RED}######################################################################${NC}"
echo -e "${RED}############ STOPPING SWISS ON FHIR APPLICATION CONTAINER ############${NC}"
echo -e "${RED}######################################################################${NC}"

docker stop swiss_app 

echo -e "${RED}##################################################################${NC}"
echo -e "${RED}########## REMOVING SWISS ON FHIR APPLICATION CONTAINER ##########${NC}"
echo -e "${RED}##################################################################${NC}"

docker rm swiss_app

echo -e "${RED}To run the container again, run the command: docker run -d -p 4200:80 --env-file .env  --name swiss_app swiss${NC}"
