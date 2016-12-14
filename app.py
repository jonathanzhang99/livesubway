from eventlet import monkey_patch
from flask import Flask, json, jsonify, render_template
from flask_socketio import SocketIO, emit

import feed

monkey_patch()

app = Flask(__name__)
socketio = SocketIO(app)
shapes = json.load(open("shapes.json", "r"))
shape_indices = json.load(open("shape_indices.json", "r"))
feed_event = None


def str_coordinate(lon, lat):
    return "({}, {})".format(lon, lat)


def get_path(shape_id, start, end):
    """
    Returns the GPS coordinates of segment of a given shape, in accordance
    with the coordinates provided in the GTFS shapes.txt. GPS coordinates
    are in the format (lon, lat)

    Parameters
    ----------
    shape_id: str
        The shape ID
    start: list/tuple
        GPS coordinates of start point
    end: list/tuple
        GPS coordinates of end point

    Returns
    -------
    list[list(float, float)]
        Array of GPS coordinates along shape from start point to end point
    """

    assert shapes, "shapes.json not loaded into memory."
    assert shape_indices, "shape_indices.json not loaded into memory."

    start_index = shape_indices[shape_id][str_coordinate(start[0], start[1])]
    end_index = shape_indices[shape_id][str_coordinate(end[0], end[1])]

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
                             [-73.958372, 40.815581],
                             [-73.96411, 40.807722]),
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
    # entities = []
    # for entity in feed.current_feed.entity:
    #     route_id = entity.trip_update.trip.route_id
    #     vehicle_id = entity.vehicle.trip.route_id
    #     if ((route_id != "" and route_id == "5") or
    #        (vehicle_id != "" and vehicle_id == "5")):
    #         entities.append(entity)

    return render_template("index.html")


@app.route('/map_json')
def map_json():
    # Documentation for shapes.json:
    #   route_id : {
    #       sequence: number of points,
    #       color: route color
    #       points: [[lon, lat],...,]}

    json_input = json.load(open("shapes.json", "r"))

    return jsonify(json_input)


@app.route('/stops_json')
def stops_json():
    # Documentation for stops.json:
    #   stop_id : {
    #       lat : float,
    #       lon : float,
    #       name : string
    #   }
    json_input = json.load(open("stops.json", "r"))
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
