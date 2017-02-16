'use strict';

var L = require('leaflet');
var Geocoder = require('leaflet-control-geocoder');
var LRM = require('leaflet-routing-machine');
var locate = require('leaflet.locatecontrol');
var options = require('./lrm_options');
var links = require('./links');
var leafletOptions = require('./leaflet_options');
var ls = require('local-storage');
var tools = require('./tools');
var state = require('./state');
var localization = require('./localization');
require('./polyfill');

var parsedOptions = links.parse(window.location.search.slice(1));
var mergedOptions = L.extend(leafletOptions.defaultState, parsedOptions);
var local = localization.get(mergedOptions.language);

// load only after language was chosen
var itineraryBuilder = require('./itinerary_builder')(mergedOptions.language);

var mapLayer = leafletOptions.layer;
var overlay = leafletOptions.overlay;
var baselayer = ls.get('layer') ? mapLayer[0][ls.get('layer')] : mapLayer[0]['openstreetmap.org'];
var layers = ls.get('getOverlay') && [baselayer, overlay['Small Components']] || baselayer;
var map = L.map('map', {
  zoomControl: true,
  dragging: true,
  layers: layers,
  maxZoom: 19
}).setView(mergedOptions.center, mergedOptions.zoom);

// Pass basemap layers
mapLayer = mapLayer.reduce(function(title, layer) {
  title[layer.label] = L.tileLayer(layer.tileLayer, {
    id: layer.label
  });
  return title;
});

/* Leaflet Controls */
L.control.layers(mapLayer, overlay, {
  position: 'bottomleft'
}).addTo(map);

L.control.scale().addTo(map);

/* Store User preferences */
// store baselayer changes
map.on('baselayerchange', function(e) {
  ls.set('layer', e.name);
});
// store overlay add or remove
map.on('overlayadd', function(e) {
  ls.set('getOverlay', true);
});
map.on('overlayremove', function(e) {
  ls.set('getOverlay', false);
});

/* OSRM setup */
var ReversablePlan = L.Routing.Plan.extend({
  createGeocoders: function() {
    var container = L.Routing.Plan.prototype.createGeocoders.call(this);
    return container;
  }
});

/* Setup markers */
function makeIcon(i, n) {
  var url = 'images/marker-via-icon-2x.png';
  var markerList = ['images/marker-start-icon-2x.png', 'images/marker-end-icon-2x.png'];
  if (i === 0) {
    return L.icon({
      iconUrl: markerList[0],
      iconSize: [20, 56],
      iconAnchor: [10, 28]
    });
  }
  if (i === n - 1) {
    return L.icon({
      iconUrl: markerList[1],
      iconSize: [20, 56],
      iconAnchor: [10, 28]
    });
  } else {
    return L.icon({
      iconUrl: url,
      iconSize: [20, 56],
      iconAnchor: [10, 28]
    });
  }
}

var plan = new ReversablePlan([], {
  geocoder: Geocoder.nominatim(),
  routeWhileDragging: true,
  createMarker: function(i, wp, n) {
    var options = {
      draggable: this.draggableWaypoints,
      icon: makeIcon(i, n)
    };
    var marker = L.marker(wp.latLng, options);
    marker.on('click', function() {
      plan.spliceWaypoints(i, 1);
    });
    return marker;
  },
  routeDragInterval: options.lrm.routeDragInterval,
  addWaypoints: true,
  waypointMode: 'snap',
  position: 'topright',
  useZoomParameter: options.lrm.useZoomParameter,
  reverseWaypoints: true,
  dragStyles: options.lrm.dragStyles,
  geocodersClassName: options.lrm.geocodersClassName,
  geocoderPlaceholder: function(i, n) {
    var startend = [local['Start - press enter to drop marker'], local['End - press enter to drop marker']];
    var via = [local['Via point - press enter to drop marker']];
    if (i === 0) {
      return startend[0];
    }
    if (i === (n - 1)) {
      return startend[1];
    } else {
      return via;
    }
  }
});

L.extend(L.Routing, itineraryBuilder);

// add marker labels
var controlOptions = {
  plan: plan,
  routeWhileDragging: options.lrm.routeWhileDragging,
  lineOptions: options.lrm.lineOptions,
  altLineOptions: options.lrm.altLineOptions,
  summaryTemplate: options.lrm.summaryTemplate,
  containerClassName: options.lrm.containerClassName,
  alternativeClassName: options.lrm.alternativeClassName,
  stepClassName: options.lrm.stepClassName,
  language: mergedOptions.language,
  showAlternatives: options.lrm.showAlternatives,
  units: mergedOptions.units,
  serviceUrl: leafletOptions.services[0].path,
  useZoomParameter: options.lrm.useZoomParameter,
  routeDragInterval: options.lrm.routeDragInterval
};
var router = (new L.Routing.OSRMv1(controlOptions));
router._convertRouteOriginal = router._convertRoute;
router._convertRoute = function(responseRoute) {
  // monkey-patch L.Routing.OSRMv1 until it's easier to overwrite with a hook
  var resp = this._convertRouteOriginal(responseRoute);

  if (resp.instructions && resp.instructions.length) {
    var i = 0;
    responseRoute.legs.forEach(function(leg) {
      leg.steps.forEach(function(step) {
        // abusing the text property to save the origina osrm step
        // for later use in the itnerary builder
        resp.instructions[i].text = step;
        i++;
      });
    });
  };

  return resp;
};
var lrmControl = L.Routing.control(Object.assign(controlOptions, {
  router: router
})).addTo(map);
var toolsControl = tools.control(localization.get(mergedOptions.language), localization.getLanguages(), options.tools).addTo(map);
var state = state(map, lrmControl, toolsControl, mergedOptions);

plan.on('waypointgeocoded', function(e) {
  if (plan._waypoints.filter(function(wp) { return !!wp.latLng; }).length < 2) {
    map.panTo(e.waypoint.latLng);
  }
});

// add onClick event
map.on('click', addWaypoint);
function addWaypoint(e) {
  var length = lrmControl.getWaypoints().filter(function(pnt) {
    return pnt.latLng;
  });
  length = length.length;
  if (!length) {
    lrmControl.spliceWaypoints(0, 1, e.latlng);
  } else {
    if (length === 1) length = length + 1;
    lrmControl.spliceWaypoints(length - 1, 1, e.latlng);
  }
}

// User selected routes
lrmControl.on('alternateChosen', function(e) {
  var directions = document.querySelectorAll('.leaflet-routing-alt');
  if (directions[0].style.display != 'none') {
    directions[0].style.display = 'none';
    directions[1].style.display = 'block';
  } else {
    directions[0].style.display = 'block';
    directions[1].style.display = 'none';
  }
});

L.control.locate({
  follow: false,
  setView: true,
  remainActive: false,
  keepCurrentZoomLevel: true,
  stopFollowingOnDrag: false,
  onLocationError: function(err) {
    alert(err.message)
  },
  onLocationOutsideMapBounds: function(context) {
    alert(context.options.strings.outsideMapBoundsMsg);
  },
  showPopup: false,
  locateOptions: {}
}).addTo(map);

/* see http://jsfiddle.net/FranceImage/1yaqtx9u/ / https://github.com/turban/Leaflet.Mask/blob/master/L.Mask.js */
L.Mask = L.Polygon.extend({
  options: {
    stroke: false,
    color: '#333',
    fillOpacity: 0.3,
    clickable: true,

    outerBounds: new L.LatLngBounds([-90, -360], [90, 360])
  },

  initialize: function (latLngs, options) {

         var outerBoundsLatLngs = [
      this.options.outerBounds.getSouthWest(),
      this.options.outerBounds.getNorthWest(),
      this.options.outerBounds.getNorthEast(),
      this.options.outerBounds.getSouthEast()
    ];
        L.Polygon.prototype.initialize.call(this, [outerBoundsLatLngs, latLngs], options);
  },

});
L.mask = function (latLngs, options) {
  return new L.Mask(latLngs, options);
};

var geoJSONdata = {"type":"FeatureCollection","generator":"JOSM","features":[{"type":"Feature","properties":{"name":"erhebungsgebiete-graz"},"geometry":{"type":"LineString","coordinates":[[15.446276,47.080905],[15.448185,47.079204],[15.450828,47.076295],[15.452189,47.07607],[15.454463,47.073317],[15.452884,47.072338],[15.452104,47.069576],[15.453154,47.06891],[15.451882,47.067877],[15.454464,47.066818],[15.453959,47.065973],[15.458708,47.061915],[15.46177,47.061018],[15.460647,47.059708],[15.452804,47.056996],[15.44726995634,47.05537021279],[15.44626144576,47.05753376974],[15.44482378172,47.06014307806],[15.44251976418,47.06407324474],[15.44039009022,47.06423402642],[15.43486742186,47.0639435228],[15.435059,47.065204],[15.435325,47.070943],[15.433993,47.076265],[15.434349,47.077841],[15.436569,47.079225],[15.44238,47.079919],[15.446276,47.080905]]}}]}

var coordinates = geoJSONdata.features[0].geometry.coordinates;
var latLngs = [];
for (var i=0; i<coordinates.length; i++) {
    latLngs.push(new L.LatLng(coordinates[i][1], coordinates[i][0]));
}

L.mask(latLngs).addTo(map);

function updateMapSwitcherLinks() {
  var newParms = window.location.href.split('?')[1];
  var childs = document.getElementsByName("osrmlink");
  for ( var i=0; i < childs.length; i++) {
    var a_element = childs[i];
    var href = a_element.getAttribute("href");
    var splitstr = href.split('?');
    href = splitstr[0] + "?" + newParms;
    a_element.setAttribute("href",href);
  }
}
map.on("zoomlevelschange", updateMapSwitcherLinks);
map.on("zoomend", updateMapSwitcherLinks);
map.on("moveend", updateMapSwitcherLinks);
map.on("load", updateMapSwitcherLinks);
map.on("click", updateMapSwitcherLinks);

setTimeout(updateMapSwitcherLinks,500);
