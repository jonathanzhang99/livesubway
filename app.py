from collections import namedtuple

from eventlet import monkey_patch
from flask import Flask, json, jsonify, render_template
from flask_socketio import SocketIO, emit

import feed

monkey_patch()

app = Flask(__name__)
socketio = SocketIO(app)
feed_event = None
with open("shapes.json", "r") as shapes_f, \
        open("shape_indices.json", "r") as shape_indices_f:
    shapes = json.load(shapes_f)
    shape_indices = json.load(shape_indices_f)


class Coordinates(namedtuple('NamedTupleCoordinates', ['lon', 'lat'])):
    def __str__(self):
        return "({}, {})".format(self.lon, self.lat)


def get_path(shape_id, start, end):
    """
    Returns the GPS coordinates of segment of a given shape, in accordance
    with the coordinates provided in the GTFS shapes.txt. GPS coordinates
    are in the format (lon, lat)

    Parameters
    ----------
    shape_id: str
        The shape ID
    start: Coordinates
        GPS coordinates of start point
    end: Coordinates
        GPS coordinates of end point

    Returns
    -------
    list[list(float, float)]
        Array of GPS coordinates along shape from start point to end point
    """

    start_index = shape_indices[shape_id][str(start)]
    end_index = shape_indices[shape_id][str(end)]

    return shapes[shape_id]["points"][start_index:end_index + 1]

demos = [
    [
        {
            "path": [[-73.96411, 40.807722], [-73.958372, 40.815581]],
            "progress": 0.5,
            "remaining_time": 10
        },
        {
            "path": get_path("1..S04R",
                             Coordinates(-73.958372, 40.815581),
                             Coordinates(-73.96411, 40.807722)),
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

_t_hash = feed.train_id_hash()


@app.route('/')
def index():
    # entities = []
    # for entity in feed.current_feed.entity:
    #     route_id = entity.trip_update.trip.route_id
    #     vehicle_id = entity.vehicle.trip.route_id
    #     if ((route_id != "" and route_id == "5") or
    #        (vehicle_id != "" and vehicle_id == "5")):
    #         entities.append(entity)t
    print _t_hash.getPrevStop("1", 1)
    return render_template("index.html")


@app.route('/map_json')
def map_json():
    # Documentation for shapes.json:
    #   route_id : {
    #       sequence: number of points,
    #       color: route color
    #       points: [[lon, lat],...,]}
    with open("shapes.json", "r") as shapes_f:
        json_input = json.load(shapes_f)
        return jsonify(json_input)


@app.route('/stops_json')
def stops_json():
    # Documentation for stops.json:
    #   stop_id : {
    #       lat : float,
    #       lon : float,
    #       name : string
    #   }
    with open("stops.json", "r") as stops_f:
        json_input = json.load(stops_f)
        return jsonify(json_input)


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
