import json
import transitfeed

# TODO: Move this to a database, or just more efficient in general


def str_coordinate(lon, lat):
    return "({}, {})".format(lon, lat)

print "Loading static transit information..."
loader = transitfeed.Loader("./static_transit")
schedule = loader.Load()
print "Done. Writing to JSON files..."

with open("shapes.json", "w") as shapes_f, \
        open("shape_indices.json", "w") as shape_indices_f:
    shapes = {}
    shape_indices = {}

    for shape_object in schedule.GetShapeList():
        shape_id = shape_object.shape_id
        shape = shapes[shape_id] = {}
        shape_indices[shape_id] = {}

        shape["sequence"] = shape_object.sequence[-1]
        shape["points"] = []

        color = ''
        for route in schedule.GetRouteList():
            if shape_id[0] == route.route_id[0]:
                color = "#" + route.route_color

        shape["color"] = color

        for i in xrange(len(shape_object.points)):
            point = shape_object.points[i]
            # We reverse the coordinates, as GTFS stores coordinates as
            # (lat, lon) while Mapbox stores coordinates as (lon, lat)
            shape["points"].append((point[1], point[0]))
            shape_indices[shape_id][str_coordinate(point[1], point[0])] = i

    shapes_f.write(json.dumps(shapes))
    shape_indices_f.write(json.dumps(shape_indices))

with open("stops.json", "w") as stops_f:
    stops = {}

    for stop_object in schedule.GetStopList():
        if stop_object.location_type == 1:
            stop_id = stop_object.stop_id
            stop = stops[stop_id] = {}

            stop["coordinates"] = [stop_object.stop_lon, stop_object.stop_lat]
            stop["name"] = stop_object.stop_name

    stops_f.write(json.dumps(stops))

print "JSON files written."
