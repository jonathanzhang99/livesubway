from eventlet.greenthread import sleep, spawn
import requests
import transitfeed

from API_KEYS import mta_key

import gtfs_realtime_pb2 as gtfs


MTA_ENDPOINT = "http://datamine.mta.info/mta_esi.php?key={}&feed_id=1" \
    .format(mta_key)

current_feed = None


class train_id_hash():
    trip_hash = {}

    def __init__(self):
        print "Initializing train_id_hash object..."
        tt = transitfeed.Loader("./static_transit")
        tf = tt.Load()
        print "Finished loading Loader"
        train_trips = tf.GetTripList()
        for trip in train_trips:
            ind = trip.trip_id.rfind(".")
            if ind == -1:
                print "Error with tripID"
                continue
            line = trip.trip_id[ind - 2] + \
                "" if trip.trip_id[ind - 1] == "." \
                else trip.trip_id[ind - 1] + \
                trip.trip_id[ind + 1]
            if line not in self.trip_hash:
                st = trip.GetStopTimes()
                self.trip_hash[line] = [None] * (len(st) + 1)
                for train_stop in st:
                    self.trip_hash[line][(int)(train_stop.stop_sequence)] = \
                        (train_stop.stop.stop_id, train_stop.stop.stop_name)

    def getPrevStop(self, route_id, stop_sequence):
        return self.trip_hash[route_id][stop_sequence]


def start_timer():
    return spawn(feed_timer)


def feed_timer():
    while True:
        global current_feed
        current_feed = spawn(get_feed).wait()
        sleep(30)


def get_feed():
    print "Retrieving feed..."
    raw_gtfs = requests.get(MTA_ENDPOINT)
    new_feed = gtfs.FeedMessage()
    new_feed.ParseFromString(raw_gtfs.content)
    print "Retrieved feed."
    return new_feed

# testing API usage
# for entity in feed.entity:
#     if (entity.trip_update.trip.HasExtension(nyct.nyct_trip_descriptor)):
#         print entity.trip_update.trip.Extensions[nyct.nyct_trip_descriptor]
