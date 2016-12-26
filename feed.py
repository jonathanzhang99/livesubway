from eventlet.greenthread import sleep, spawn
import requests

from API_KEYS import mta_key
import gtfs_realtime_pb2 as gtfs

MTA_ENDPOINT = "http://datamine.mta.info/mta_esi.php?key={}&feed_id=1" \
    .format(mta_key)

current_feed = None


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
