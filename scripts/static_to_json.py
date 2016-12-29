from argparse import ArgumentParser
from collections import namedtuple

import simplejson as json
import transitfeed

# TODO: Move this to a database, or make it more efficient in general


class Coordinates(namedtuple('Coordinates', ['lon', 'lat'])):
    def __str__(self):
        return "({}, {})".format(self.lon, self.lat)


class Segment(namedtuple('Segment', ['start', 'end'])):
    def __str__(self):
        return "({}, {})".format(self.start, self.end)

Edge = namedtuple('Edge', ['shape_id', 'start_index', 'end_index'])

JSON_DIR = "static/json/"
STATIC_TRANSIT_DIR = "static_transit/"


OLD_SOUTH_FERRY = Coordinates(-74.013664, 40.702068)
NEW_SOUTH_FERRY = Coordinates(-74.013205, 40.701411)


YORK_STREET = Coordinates(-73.986751, 40.701397)
YORK_STREET_APPROX = Coordinates(-73.986885, 40.699743)
YORK_STREET_ID = "F18"
YORK_STREET_SHAPE = "F..N75R"


SECOND_AVE_PATHS = set(["N..N63R", "N..N67R", "N..S16R", "Q..N16R", "Q..N19R",
                        "Q..S16R", "Q..S19R"])


def get_stop_coords(stop_object):
    coordinates = Coordinates(stop_object.stop_lon,
                              stop_object.stop_lat)
    if coordinates == NEW_SOUTH_FERRY:
        return OLD_SOUTH_FERRY

    else:
        return coordinates


def get_shape_indices(schedule):
    shape_indices = {}

    for shape_object in schedule.GetShapeList():
        shape_id = shape_object.shape_id
        shape_indices[shape_id] = {}

        for i in xrange(len(shape_object.points)):
            point = shape_object.points[i]
            # We reverse the coordinates, as GTFS stores coordinates as
            # (lat, lon) while Mapbox stores coordinates as (lon, lat)
            coordinates = Coordinates(point[1], point[0])

            shape_indices[shape_id][coordinates] = i

    return shape_indices


def get_stop_shapes(schedule, stop_coords):
    stop_shapes = {}

    for shape_object in schedule.GetShapeList():
        shape_id = shape_object.shape_id
        for point in shape_object.points:
            coordinates = Coordinates(point[1], point[0])

            if coordinates in stop_coords:
                stop_ids = stop_coords[coordinates]

                for stop_id in stop_ids:
                    if stop_id in stop_shapes:
                        stop_shapes[stop_id].add(shape_id)

                    else:
                        stop_shapes[stop_id] = set([shape_id])

    return stop_shapes


def get_stop_edge(start, end, stop_shapes, shape_indices):
    start_coords = get_stop_coords(start)
    end_coords = get_stop_coords(end)

    start_station = schedule.GetStop(start.stop_id) \
        .parent_station
    end_station = schedule.GetStop(end.stop_id).parent_station

    if start_station == YORK_STREET_ID or \
            end_station == YORK_STREET_ID:
        shape_id = YORK_STREET_SHAPE

        if start_station == YORK_STREET_ID:
            start_index = \
                shape_indices[shape_id][YORK_STREET_APPROX]
            end_index = shape_indices[shape_id][end_coords]

        elif end_station == YORK_STREET_ID:
            start_index = \
                shape_indices[shape_id][start_coords]
            end_index = \
                shape_indices[shape_id][YORK_STREET_APPROX]

    else:
        common_shapes = stop_shapes[start_station] \
            .intersection(stop_shapes[end_station])

        shape_id = common_shapes.pop()
        start_index = shape_indices[shape_id][start_coords]
        end_index = shape_indices[shape_id][end_coords]

    return Edge(shape_id, start_index, end_index)


def parse_shapes(schedule):
    with open(JSON_DIR + "shapes.json", "w") as shapes_f:
        shapes = {}

        for shape_object in schedule.GetShapeList():
            shape_id = shape_object.shape_id
            shape = shapes[shape_id] = {}

            shape["sequence"] = shape_object.sequence[-1]
            shape["points"] = []

            color = ''
            for route in schedule.GetRouteList():
                if shape_id[0] == route.route_id[0]:
                    color = "#" + route.route_color

            shape["color"] = color

            for point in shape_object.points:
                # We reverse the coordinates, as GTFS stores coordinates as
                # (lat, lon) while Mapbox stores coordinates as (lon, lat).
                # Moreover, we use an array here as opposed to the Coordinates
                # class for ease at the cost of readability, as the points in
                # shapes.json will be passed to Mapbox, which only handles GPS
                # coordinates in array format.
                coordinates = [point[1], point[0]]
                shape["points"].append(coordinates)

        shapes_f.write(json.dumps(shapes))
        print "shapes.json written."


def parse_stops(schedule):
    with open(JSON_DIR + "stops.json", "w") as stops_f:
        stops = {}

        for stop_object in schedule.GetStopList():
            if stop_object.location_type == 1:
                stop_id = stop_object.stop_id
                stop = stops[stop_id] = {}

                stop["coordinates"] = get_stop_coords(stop_object)
                stop["name"] = stop_object.stop_name

        stops_f.write(json.dumps(stops))
        print "stops.json written."


def parse_graph(schedule):
    with open(JSON_DIR + "graph.json", "w") as graph_f:
        vertices = {}
        edges = {}
        shape_indices = get_shape_indices(schedule)
        stop_coords = {}

        for stop_object in schedule.GetStopList():
            if stop_object.location_type == 1:
                stop_id = stop_object.stop_id
                coordinates = get_stop_coords(stop_object)

                vertices[stop_id] = {}

                if coordinates in stop_coords:
                    stop_coords[coordinates].append(stop_id)

                else:
                    stop_coords[coordinates] = [stop_id]

        stop_shapes = get_stop_shapes(schedule, stop_coords)

        for trip_object in schedule.GetTripList():
            trip_path = trip_object.trip_id.split("_")[-1]
            if trip_path in SECOND_AVE_PATHS:
                continue

            stops = trip_object.GetPattern()
            for i in xrange(len(stops) - 1):
                start = stops[i]
                end = stops[i + 1]

                start_id = start.stop_id
                end_id = end.stop_id

                start_station = schedule.GetStop(start.stop_id) \
                    .parent_station
                end_station = schedule.GetStop(end.stop_id).parent_station

                if str(Segment(start_id, end_id)) in edges:
                    vertices[start_station][end_station] = 1

                elif str(Segment(end_id, start_id)) in edges:
                    vertices[start_station][end_station] = -1

                else:
                    edges[str(Segment(start_id, end_id))] = \
                        get_stop_edge(start, end, stop_shapes, shape_indices)

        graph_f.write(json.dumps({"vertices": vertices, "edges": edges}))
        print "graph.json written."


def get_parser():
    parser = ArgumentParser(
        description="A script to write JSON files with " +
        "needed static transit data."
    )
    parser.add_argument(
        "--no_stops",
        action="store_true",
        default=False,
        help="Flag to disable creation of stops.json"
    )
    parser.add_argument(
        "--no_shapes",
        action="store_true",
        default=False,
        help="Flag to disable creation of shapes.json"
    )
    parser.add_argument(
        "--no_graph",
        action="store_true",
        default=False,
        help="Flag to disable creation of graph.json"
    )

    return parser


if __name__ == "__main__":
    args = get_parser().parse_args()

    if args.no_shapes and args.no_stops and args.no_graph:
        print "No JSON files written."

    else:
        print "Loading static transit information..."
        loader = transitfeed.Loader(STATIC_TRANSIT_DIR)
        schedule = loader.Load()
        print "Done. Writing to JSON file(s)..."

        if args.no_shapes:
            print "Skipping shapes.json."

        else:
            parse_shapes(schedule)

        if args.no_stops:
            print "Skipping stops.json."

        else:
            parse_stops(schedule)

        if args.no_graph:
            print "Skipping graphs.json."

        else:
            parse_graph(schedule)

        print "JSON file(s) written."
