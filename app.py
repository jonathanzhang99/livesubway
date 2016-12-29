from collections import namedtuple

from eventlet import monkey_patch
from flask import Flask, json, jsonify, render_template
from flask_socketio import SocketIO, emit

from API_KEYS import mapbox_key
import feed

monkey_patch()

JSON_DIR = "static/json/"
app = Flask(__name__)
socketio = SocketIO(app)
feed_event = None
with open(JSON_DIR + "graph.json", "r") as graph_f, \
        open(JSON_DIR + "shapes.json", "r") as shapes_f, \
        open(JSON_DIR + "stops.json", "r") as stops_f:
    graph = json.load(graph_f)
    shapes = json.load(shapes_f)
    stops = json.load(stops_f)


class Segment(namedtuple('Segment', ['start', 'end'])):
    def __str__(self):
        return "({}, {})".format(self.start, self.end)


def get_path(start, end):
    """Returns sequence of points between two stops.

    The two stops need to be adjacent stops on any particular
    trip (local or express).

    Moreover, in the graph JSON file, only one edge for each
    segment of stop endpoints is stored; thus, in order to
    return the correct sequence of points, we must keep track
    of two things. One, the relative orientation of the
    requested stops with the segment of stops stored in the graph,
    and two, the actual orientation of the stored edge with the
    shape. In particular, the stored edge may represent a path
    that goes northbound (since edges are represented as a
    start/end structure and are thus "directed"), but the shape
    that is being used for this edge may actually be southbound.

    Thus, we store these orientations as +/-1, and simply compose
    the orientations, so that at most one "flip" of the sequence of
    points from shapes.json is needed.

    Arguments
    ---------
    start: str
        Station ID of start stop (must be a parent station)
    end: str
        Station ID of end stop (must be a parent station)

    Returns
    -------
    list[[float, float]]
        List of coordinates in the form [lon, lat]
    """
    edges = graph["edges"]
    if str(Segment(start, end)) in edges:
        edge = edges[str(Segment(start, end))]
        relative_orientation = 1

    else:
        edge = edges[str(Segment(end, start))]
        relative_orientation = -1

    shape_id = edge["shape_id"]
    start_index, end_index = sorted((int(edge["start_index"]),
                                     int(edge["end_index"])))
    shape_orientation = 1 if start_index == int(edge["start_index"]) else -1
    points = shapes[shape_id]["points"][start_index:end_index + 1]

    if relative_orientation * shape_orientation == 1:
        return points

    else:
        return points[::-1]

demos = [
    [
        {
            "path": [[-73.96411, 40.807722], [-73.958372, 40.815581]],
            "progress": 0.5,
            "remaining_time": 10
        },
        {
            "path": get_path("118", "119"),
            "progress": 0.3,
            "remaining_time": 15
        }
    ],
    [
        {
            "path": [[-73.96411, 40.807722], [-73.959874, 40.77362]],
            "progress": 0.5,
            "remaining_time": 10
        },
        {
            "path": [[-73.958372, 40.815581], [-73.987691, 40.755477]],
            "progress": 0.3,
            "remaining_time": 25
        },
    ],
    [
        {
            "path": [[-73.958372, 40.815581], [-73.987691, 40.755477]],
            "progress": 0.3,
            "remaining_time": 25
        },
        {
            "path": [[-73.992629, 40.730328], [-73.989951, 40.734673]],
            "progress": 0.3,
            "remaining_time": 15
        }
    ]
]


@app.route('/')
def index():
    return render_template("index.html", mapbox_key=mapbox_key)


@app.route('/map_json')
def map_json():
    # Documentation for shapes.json:
    # shape_id: {
    #      sequence: number of points,
    #      color: route color,
    #      points: [[lon, lat],...,]
    # }
    return jsonify(shapes)


@app.route('/stops_json')
def stops_json():
    # Documentation for stops.json:
    # stop_id: {
    #      coordinates: {
    #          lat: latitude,
    #          lon: longitude
    #      },
    #      name: name
    # }
    return jsonify(stops)


@socketio.on('get_feed')
def subway_cars():
    global feed_event
    if feed_event is None:
        feed_event = socketio.start_background_task(target=subway_cars_timer)

    print "Emitted."
    emit('feed', demos[0])


def subway_cars_timer():
    counter = 1
    while True:
        socketio.sleep(30)
        demo_emit = demos[counter % len(demos)]
        print "Emitted."
        socketio.emit('feed', demo_emit)
        counter += 1


if __name__ == "__main__":
    feed_thread = feed.start_timer()

    try:
        socketio.run(app, debug=True)

    finally:
        feed_thread.cancel()
