@echo off
echo Stopping old Redis container...
docker rm -f lecture-redis
echo Starting new Redis container...
docker run -d --name lecture-redis -p 6379:6379 redis:7-alpine
echo Done!
pause
