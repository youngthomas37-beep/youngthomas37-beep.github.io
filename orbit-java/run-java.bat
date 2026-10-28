@echo off
cd /d "%~dp0"
java -jar SolarLunarMission.jar --gui
if errorlevel 1 pause
