OSRM frontend for routing on wheelroute.at

how to update the grey area boundaries:

* open ``src/index.js``
* copy value of ``var geoJSONdata =`` into a file
* open this file with JOSM, edit data
* save file, compress with ``cat umriss2.geojson |jq "." -c > umriss2s.geojson``
* copy compressed text into index.js, save
* in the repository root, do: ``npm install``
* compile with ``npm start``
