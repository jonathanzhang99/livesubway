
function log(msg) {
    console.log(msg);
}

$(document).ready(function() {
    mapboxgl.accessToken = "pk.eyJ1Ijoiam9uYXRoYW56aGFuZzk5IiwiYSI6ImNpdjQzMGZjazAwMmsydHJpbW03ZTN4cnEifQ.HD9WQRZXTUG6ygjZ8VWxTg";
    var map = new mapboxgl.Map({
        container: "subwaymap",
        style: 'mapbox://styles/mapbox/light-v9',
        //maxBounds: [[-73.995130, 40.79896], [-73.97, 40.76]],
        center: [-73.983393, 40.788552],
        dragRotate: false,
        zoom: 10.84,
    });


    map.on('load', function() {
        var subway_cars = []
        var socket = io.connect("localhost:5000");

        var route_ids_list = [
                            "route-1..N03R",
                            "route-5..S03R", 
                            "route-A..N04R", 
                            "route-N..N20R",
                            "route-D..N05R",
                            "route-B..N46R"
                            ];
                            
        $.when(
            $.getJSON("/map_json", function(mapdata) {
                $.each(mapdata, function(mapkey, mapval) {
                    var route_id = "route-".concat(mapkey);
                        
                    map.addSource(route_id, {
                        "type": "geojson",
                        "data": {
                            "type": "Feature",
                            "properties": {
                                "color": mapval.color
                            },
                            "geometry": {
                                "type": "LineString",
                                "coordinates": mapval.points
                            }
                        }
                    });
                });

                $.each(route_ids_list, function(index, key) {
                    map.addLayer({
                        "id": key,
                        "type": "line",
                        "source": key,
                        "layout": {
                            "line-join": "round",
                            "line-cap": "round"
                        },
                        "paint": {
                            "line-color": map.getSource(key)._data.properties.color,
                            "line-width": 3
                        }
                    });
                });

                $.getJSON("/stops_json", function(stopdata) {
                    var stops_feature_data = [];
                    $.each(stopdata, function(stopkey, stopval) {
                        var descriptionHTML = "<strong>" + stopval.name + "</strong><br><p>" 
                            + stopval.coordinates.join(', ') + "</p>";
                        stop_source = {
                            "type": "Feature",
                            "properties": {
                                "description": descriptionHTML
                            },
                            "geometry": {
                                "type": "Point",
                                "coordinates": stopval.coordinates
                            }
                        };
                        stops_feature_data.push(stop_source);
                    });

                    map.addSource("stops", {
                        "type": "geojson",
                        "data": {
                            "type": "FeatureCollection",
                            "features": stops_feature_data
                        }
                    });
                    map.addLayer({
                        "id": "stops",
                        "type": "circle",
                        "source": "stops",
                        "paint": {
                            "circle-radius": {
                                "stops": [[11, 3], [14, 4], [16, 5]]
                            },
                            "circle-color": "#ff3300"
                        }
                    });
                });
            }),
            socket.on('feed', function(subway_cars) {
                renderCars(subway_cars);
            })
        ).then(function() {
            socket.emit('get_feed');
        });

        var popup = new mapboxgl.Popup({
            closeButton:false,
            closeOnClick: false
        });

        map.on('mousemove', function(e){
            var features = map.queryRenderedFeatures(e.point, {layers: ["stops"]});
            map.getCanvas().style.cursor = (features.length) ? "pointer": "";
            if (!features.length){
                popup.remove();
                return;
            }

            var feature = features[0];
            popup.setLngLat(feature.geometry.coordinates)
                .setHTML(feature.properties.description)
                .addTo(map);

        });
    });

    function renderCars(subway_cars) {
        var speed = 60;
        var duration = 30;
        var total_frames = speed * duration;
        var points = [];
        var all_anim_steps = [];
        $.each(subway_cars, function(index, subway_car) {
            var line = {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": subway_car.path
                }
            };
            var distance =  turf.lineDistance(line, "miles");
            var distance_traveled = subway_car.progress * distance;
            var remaining_distance = distance - distance_traveled;

            point = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": turf.along(line, distance_traveled, "miles").geometry.coordinates
                }
            };
            points.push(point);

            anim_steps = [];
            anim_speed = speed * subway_car.remaining_time;
            anim_frames = speed * Math.min(duration, subway_car.remaining_time);

            for (var i = 0; i < anim_frames; i++) {
                var step = i / anim_speed * remaining_distance;
                var segment = turf.along(line, distance_traveled + step, "miles");
                anim_steps.push(segment.geometry.coordinates);
            }

            if (anim_frames < total_frames) {
                for (var i = anim_frames; i < total_frames; i++) {
                    var segment = turf.along(line, distance, "miles");
                    anim_steps.push(segment.geometry.coordinates);
                }
            }
            console.assert(anim_steps.length == total_frames);
            all_anim_steps.push(anim_steps);
        });

        var source = {
            "type": "geojson",
            "data": {
                "type": "FeatureCollection",
                "features": points
            }
        };

        if (map.getSource("subway_cars") == undefined) {
            map.addSource("subway_cars", source);
        }

        else {
            map.getSource("subway_cars").setData(source.data);
        }

        if (map.getLayer("subway_cars") == undefined) {
            map.addLayer({
                "id": "subway_cars",
                "type": "circle",
                "source": "subway_cars",
                "paint": {
                    "circle-radius": 4,
                    "circle-color": "#000000"
                }
            });
        }

        var interval = 1000 / speed;
        var then = Date.now();
        var start = then;
        var counter = 0;

        function animate() {
            if (counter < speed * duration - 1) {
                requestAnimationFrame(animate);

                now = Date.now();
                elapsed = now - then;
                then = now;
                    
                for (var i = 0; i < points.length; i++) {
                    point = points[i];
                    anim_steps = all_anim_steps[i];
                    point.geometry.coordinates = anim_steps[Math.round(counter)];
                }
                map.getSource('subway_cars').setData({
                    "type": "FeatureCollection",
                    "features": points
                });

                counter += elapsed / interval;
            }

            else {
                end = Date.now();
                anim_time = (end - start) / 1000;
                log("Time elapsed for animation: " + anim_time.toString());
            }
        }

        animate();
    }
});



