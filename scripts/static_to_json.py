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

# Currently the new South Ferry station is closed due to the effects of
# Hurricane Sandy, forcing the old South Ferry station to be recommissioned
# repairs are done. However, while this is accurate in shapes.txt, the new stop
# is still being used in stops.txt, and so we replace occurrences of the new
# South Ferry stop with the old one until the static information is updated.
OLD_SOUTH_FERRY = Coordinates(-74.013664, 40.702068)
NEW_SOUTH_FERRY = Coordinates(-74.013205, 40.701411)

# shapes.txt currently has a hole containing the York St. stop for some reason,
# so currently while we still refer to the York St. stop as a real stop,
# currently for purposes of convenience, we store the corresponding edge as
# the closest point to the York St. stop, and simply use this as the other
# endpoint. Moreover, since the York St. stop is not in shapes.txt, we also
# provide relevant information for the stop ID/shape for creating the graph.
#
# We may be able to have two approximate points depending on the
# direction of the segment, but not entirely sure if this is necessary.
# Hopefully this gets fixed in a future iteration of the static transit
# information.
YORK_STREET = Coordinates(-73.986751, 40.701397)
YORK_STREET_APPROX = Coordinates(-73.986885, 40.699743)
YORK_STREET_ID = "F18"
YORK_STREET_SHAPE = "F..N68R"

# The script currently skips paths that go along the Second Avenue Subway Line,
# as these are part of the new N/Q (and soon to be T) lines that open up in
# January 2017. While this data is provided as part of stops/stop_times, the
# shapes are not provided in shapes.txt, so we skip these paths until the
# static information is eventually updated (hopefully the next iteration once
# the lines begin operation).
SECOND_AVE_PATHS = set(["N..N63R", "N..N67R", "N..S16R", "Q..N16R", "Q..N19R",
                        "Q..S16R", "Q..S19R"])


def get_stop_coords(stop_object):
    """Return coordinates of a Stop object.

    Arguments
    ---------
    stop_object: transitfeed.Stop
        Stop object

    Returns
    -------
    Coordinates
        Coordinates of Stop object
    """
    coordinates = Coordinates(stop_object.stop_lon,
                              stop_object.stop_lat)
    # See top of script for an explanation of why the
    # South Ferry stop is handled differently.
    if coordinates == NEW_SOUTH_FERRY:
        return OLD_SOUTH_FERRY

    else:
        return coordinates


def get_shape_indices(schedule):
    """Return map of point indices for each shape.

    This is used for forming the edges of the stop graph,
    so that each edge can find the corresponding indices
    of two stops along a shape and store these indices as the
    boundary indices of the edge (then when sending the GPS
    coordinates to the client code, we can simply use an array
    slice on these indices from the shape's point sequence).

    Arguments
    ---------
    schedule: transitfeed.Schedule
        Schedule object

    Returns
    -------
    dict[str -> dict[str -> int]]
        Map of shape ID -> map of point -> index of point
    """
    shape_indices = {}

    for shape_object in schedule.GetShapeList():
        shape_id = shape_object.shape_id
        shape_indices[shape_id] = {}

        for i in xrange(len(shape_object.points)):
            point = shape_object.points[i]
            # We reverse the coordinates, as GTFS stores coordinates as
            # (lat, lon) while Mapbox stores coordinates as (lon, lat).
            coordinates = Coordinates(point[1], point[0])

            shape_indices[shape_id][coordinates] = i

    return shape_indices


def get_stop_shapes(schedule):
    """Return map of stop ID to set of shapes containing each stop.

    Arguments
    ---------
    schedule: transitfeed.Schedule
        Schedule object

    Returns
    -------
    dict[str -> set[str]]
        Map of stop ID -> set of shape IDs containing that stop's coordinates
    """
    stop_coords = {}
    stop_shapes = {}

    for stop_object in schedule.GetStopList():
        if stop_object.location_type == 1:
            stop_id = stop_object.stop_id
            coordinates = get_stop_coords(stop_object)

            if coordinates in stop_coords:
                stop_coords[coordinates].append(stop_id)

            else:
                stop_coords[coordinates] = [stop_id]

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


def get_stop_edge(segment, stop_shapes, shape_indices):
    """Return an edge of the stop graph, based on the start/end stops.

    The Edge that is constructed contains a shape ID for a shape that
    contains both the start and end stop, as well as the corresponding indices
    of those stops in the sequence of points for that shape.

    Arguments
    ---------
    segment: Segment
        Segment of start/end Stop objects
    stop_shapes: dict[str -> set[str]]
        Map of stop ID -> set of shape IDs containing that stop's coordinates
    shape_indices: dict[str -> dict[str -> int]]
        Map of shape ID -> map of point -> index of point

    Returns
    -------
    Edge
        Edge between the two stops
    """
    start = segment.start
    end = segment.end

    start_coords = get_stop_coords(start)
    end_coords = get_stop_coords(end)

    start_station = schedule.GetStop(start.stop_id) \
        .parent_station
    end_station = schedule.GetStop(end.stop_id).parent_station

    # See comments above declaration of these constants at the top of the
    # script for an explanation of why York St. cases are handled differently.
    if start_station == YORK_STREET_ID:
        shape_id = YORK_STREET_SHAPE
        start_index = \
            shape_indices[shape_id][YORK_STREET_APPROX]
        end_index = shape_indices[shape_id][end_coords]

    elif end_station == YORK_STREET_ID:
        shape_id = YORK_STREET_SHAPE
        start_index = \
            shape_indices[shape_id][start_coords]
        end_index = \
            shape_indices[shape_id][YORK_STREET_APPROX]

    else:
        # We assume that there is a unique path between any two adjacent stops
        # on the entire map for each trip, or if there isn't, the paths are
        # very similar in length/shape, which appears to be the case, so the
        # choice of shape doesn't matter, as long as it contains both stops.
        common_shapes = stop_shapes[start_station] \
            .intersection(stop_shapes[end_station])

        shape_id = common_shapes.pop()
        start_index = shape_indices[shape_id][start_coords]
        end_index = shape_indices[shape_id][end_coords]

    return Edge(shape_id, start_index, end_index)


def parse_shapes(schedule):
    """Writes shapes.json.

    This JSON file is sent to the client code in order to render
    the actual subway lines on the map. It is also used to retrieve
    sequences of points used to animate the paths of the subway cars
    along the subway lines.

    Writes a JSON file of the following format:
    {
        shape_id: {
            color: route color for shape,
            sequence: number of points in shape,
            points: [[lon, lat], ...]
        }
    }

    Arguments
    ---------
    schedule: transitfeed.Schedule
        Schedule object
    """
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
    """Writes stops.json.

    This JSON file is sent to the client code to render the stops on the map.

    Writes a JSON file of the following format:
    {
        stop_id: {
            coordinates: {
                lat: latitude,
                lon: longitude
            },
            name: name
        }
    }

    Arguments
    ---------
    schedule: transitfeed.Schedule
        Schedule object
    """
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
    """Writes graph.json.

    This JSON file is used to retrieve sequences of points used
    to animate the paths of the subway cars along the subway lines.

    Edges are mapped by the endpoints, and the edge structure is described
    as below.

    Writes a JSON file of the following format:
    {
        edges: {
            (start_station_id, end_station_id): {
                shape_id: shape ID containing start/end stops,
                start_index: index of start stop in shape,
                end_index: index of end stop in shape
            }
        }
    }

    Arguments
    ---------
    schedule: transitfeed.Schedule
        Schedule object
    """
    with open(JSON_DIR + "graph.json", "w") as graph_f:
        edges = {}
        shape_indices = get_shape_indices(schedule)
        stop_shapes = get_stop_shapes(schedule)

        for trip_object in schedule.GetTripList():
            # For an explanation of why trip paths along 2nd Avenue
            # are currently skipped, see the top of the script.
            trip_path = trip_object.trip_id.rsplit("_", 1)[1]
            if trip_path in SECOND_AVE_PATHS:
                continue

            stops = trip_object.GetPattern()
            for i in xrange(len(stops) - 1):
                start = stops[i]
                end = stops[i + 1]

                start_station = schedule.GetStop(start.stop_id) \
                    .parent_station
                end_station = schedule.GetStop(end.stop_id).parent_station

                # If this edge (up to orientation) has not been seen before,
                # add to map.
                if str(Segment(start_station, end_station)) not in edges and \
                        str(Segment(end_station, start_station)) not in edges:
                    edges[str(Segment(start_station, end_station))] = \
                        get_stop_edge(Segment(start, end),
                                      stop_shapes,
                                      shape_indices)

        graph_f.write(json.dumps({"edges": edges}))
        print "graph.json written."


def get_parser():
    """Returns argument parser."""
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
