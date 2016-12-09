from eventlet import monkey_patch
from flask import Flask, json, jsonify, render_template
from flask_socketio import SocketIO

import feed


monkey_patch()
app = Flask(__name__)
socketio = SocketIO(app)

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

    json_input = json.load(open("shapes.json", "r"))

    return jsonify(json_input)


@app.route('/stops_json')
def stops_json():
    # Documentation for stops.json:
    #   stopid : {
    #       lat : num,
    #       lon : num,
    #       name : string
    #   }
    json_input = json.load(open("stops.json", "r"))
    return jsonify(json_input)

if __name__ == "__main__":
    feed_thread = feed.start_timer()
    try:
        socketio.run(app, debug=True)
    finally:
        feed_thread.kill()
