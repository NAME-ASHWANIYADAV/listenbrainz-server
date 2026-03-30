import * as React from "react";
import "./LiveEvents.css";
import { useState, useCallback } from "react";
import Spinner from "react-loader-spinner";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import Pill from "../../components/Pill";
import EventCard from "./components/EventCard";
import { COLOR_LB_ORANGE } from "../../utils/constants";

// Always use production APIs so the POC works without local DB setup
const LB_API_URL = "https://api.listenbrainz.org";
const MB_API_URL = "https://musicbrainz.org/ws/2";

type MBEvent = {
  id: string;
  name: string;
  type: string;
  "life-span": {
    begin: string;
    end: string;
    ended: boolean;
  };
  time?: string;
  cancelled: boolean;
  relations?: Array<{
    type: string;
    "target-type"?: string;
    direction: string;
    place?: {
      id: string;
      name: string;
    };
    artist?: {
      id: string;
      name: string;
    };
  }>;
};

type ArtistWithEvents = {
  artistName: string;
  artistMbid: string;
  listenCount: number;
  events: Array<{
    id: string;
    name: string;
    type: string;
    date: string;
    venue: string;
    artistName: string;
  }>;
};

// Respect MusicBrainz rate limit: 1 request per second
async function rateLimitedFetch(url: string): Promise<Response> {
  await new Promise((resolve) => {
    setTimeout(resolve, 1100);
  });
  return fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ListenBrainz-Events-POC/1.0",
    },
  });
}

async function fetchEventsForArtist(
  artistMbid: string,
  artistName: string
): Promise<ArtistWithEvents> {
  const url = `${MB_API_URL}/event?artist=${artistMbid}&fmt=json&limit=100`;

  try {
    const response = await rateLimitedFetch(url);
    if (!response.ok) {
      return { artistName, artistMbid, listenCount: 0, events: [] };
    }

    const data = await response.json();
    const events = (data.events || []) as MBEvent[];
    const today = new Date().toISOString().split("T")[0];

    const upcomingEvents = events
      .filter((event: MBEvent) => {
        if (event.cancelled) return false;
        const beginDate = event["life-span"]?.begin;
        return beginDate && beginDate >= today;
      })
      .map((event: MBEvent) => {
        const relations = event.relations || [];
        const heldAtRel = relations.find(
          (rel) => rel.type === "held at" && rel.place
        );
        const venue = heldAtRel?.place?.name || "Unknown Venue";

        return {
          id: event.id,
          name: event.name,
          type: event.type || "Event",
          date: event["life-span"].begin,
          venue,
          artistName,
        };
      })
      .sort(
        (a: { date: string }, b: { date: string }) =>
          new Date(a.date).getTime() - new Date(b.date).getTime()
      );

    return { artistName, artistMbid, listenCount: 0, events: upcomingEvents };
  } catch {
    return { artistName, artistMbid, listenCount: 0, events: [] };
  }
}

export default function LiveEvents() {
  const [filterType, setFilterType] = useState<string>("all");
  const [searchUser, setSearchUser] = useState<string>("");
  const [activeUser, setActiveUser] = useState<string>("");

  const handleSearch = useCallback(() => {
    const trimmed = searchUser.trim();
    if (trimmed) {
      setActiveUser(trimmed);
    }
  }, [searchUser]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSearch();
      }
    },
    [handleSearch]
  );

  const fetchAllEvents = useCallback(async (): Promise<ArtistWithEvents[]> => {
    if (!activeUser) {
      throw new Error("Please enter a ListenBrainz username to find events.");
    }

    // Step 1: Fetch user's top artists from production ListenBrainz API
    const statsUrl = `${LB_API_URL}/1/stats/user/${activeUser}/artists?range=this_month&count=10`;
    const statsResponse = await fetch(statsUrl);
    if (!statsResponse.ok) {
      throw new Error(
        `Could not fetch top artists for "${activeUser}". Check the username and try again.`
      );
    }

    const statsData = await statsResponse.json();
    const artists = statsData?.payload?.artists || [];

    // Filter to only artists with MBIDs
    const artistsWithMbids = artists.filter(
      (a: { artist_mbid: string | null }) => a.artist_mbid
    );

    if (artistsWithMbids.length === 0) {
      return [];
    }

    // Step 2: For each artist, fetch upcoming events from MusicBrainz
    // Sequential fetching to respect MB rate limiting (1 req/sec)
    const results: ArtistWithEvents[] = await artistsWithMbids.reduce(
      async (
        accPromise: Promise<ArtistWithEvents[]>,
        artist: {
          artist_mbid: string;
          artist_name: string;
          listen_count: number;
        }
      ) => {
        const acc = await accPromise;
        const artistEvents = await fetchEventsForArtist(
          artist.artist_mbid,
          artist.artist_name
        );
        artistEvents.listenCount = artist.listen_count;
        return [...acc, artistEvents];
      },
      Promise.resolve([] as ArtistWithEvents[])
    );

    return results;
  }, [activeUser]);

  const { data: artistsWithEvents, isLoading, isError, error } = useQuery<
    ArtistWithEvents[]
  >({
    queryKey: ["live-events", activeUser],
    queryFn: fetchAllEvents,
    enabled: !!activeUser,
  });

  // Flatten all events for the "all events" view
  const allEvents = React.useMemo(() => {
    if (!artistsWithEvents) return [];
    return artistsWithEvents
      .flatMap((a) => a.events)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [artistsWithEvents]);

  // Get unique event types for filter pills
  const eventTypes = React.useMemo(() => {
    const types = new Set(allEvents.map((e) => e.type));
    return ["all", ...Array.from(types)];
  }, [allEvents]);

  const filteredEvents = React.useMemo(() => {
    if (filterType === "all") return allEvents;
    return allEvents.filter((e) => e.type === filterType);
  }, [allEvents, filterType]);

  const totalEventsFound = allEvents.length;
  const artistsWithUpcomingEvents =
    artistsWithEvents?.filter((a) => a.events.length > 0).length || 0;

  return (
    <div role="main">
      <Helmet>
        <title>Live Events</title>
      </Helmet>

      <div className="listen-header">
        <h2 className="header-with-line">
          Live Events
          <span className="header-subtitle">
            Upcoming concerts for your top artists
          </span>
        </h2>
      </div>

      {/* Username Search */}
      <div className="events-search" style={{ marginBottom: "2rem" }}>
        <div
          className="input-group"
          style={{ maxWidth: 500, margin: "0 auto" }}
        >
          <input
            type="text"
            className="form-control"
            placeholder="Enter a ListenBrainz username..."
            value={searchUser}
            onChange={(e) => setSearchUser(e.target.value)}
            onKeyDown={handleKeyDown}
            id="events-username-input"
          />
          <span className="input-group-btn">
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleSearch}
              disabled={!searchUser.trim()}
              id="events-search-btn"
              style={{ backgroundColor: "#eb743b", borderColor: "#eb743b" }}
            >
              Find Events
            </button>
          </span>
        </div>
        <p
          className="text-center text-muted"
          style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}
        >
          Enter any ListenBrainz username to discover upcoming events for their
          top artists.
        </p>
      </div>

      {isLoading && (
        <div className="text-center" style={{ margin: "4rem 0" }}>
          <Spinner
            type="ThreeDots"
            color={COLOR_LB_ORANGE}
            height={80}
            width={80}
          />
          <p style={{ marginTop: "1rem", color: "#999" }}>
            Fetching events from MusicBrainz for <strong>{activeUser}</strong>
            &apos;s top artists...
            <br />
            <small>(This may take a few seconds due to rate limiting)</small>
          </p>
        </div>
      )}

      {isError && (
        <div className="alert alert-danger" role="alert">
          {(error as Error)?.message ||
            "An error occurred while fetching events."}
        </div>
      )}

      {!isLoading && !isError && activeUser && artistsWithEvents && (
        <>
          {/* Stats Summary */}
          <div className="events-summary">
            <div className="events-stat">
              <span className="events-stat-number">{totalEventsFound}</span>
              <span className="events-stat-label">Upcoming Events</span>
            </div>
            <div className="events-stat">
              <span className="events-stat-number">
                {artistsWithUpcomingEvents}
              </span>
              <span className="events-stat-label">Artists with Events</span>
            </div>
            <div className="events-stat">
              <span className="events-stat-number">
                {artistsWithEvents?.length || 0}
              </span>
              <span className="events-stat-label">Artists Checked</span>
            </div>
          </div>

          {/* Filter Pills */}
          {eventTypes.length > 1 && (
            <div className="events-filters">
              {eventTypes.map((type) => (
                <Pill
                  key={type}
                  active={filterType === type}
                  type="secondary"
                  onClick={() => setFilterType(type)}
                >
                  {type === "all" ? "All Events" : type}
                </Pill>
              ))}
            </div>
          )}

          {/* Events Grid */}
          {filteredEvents.length > 0 ? (
            <div className="events-grid">
              {filteredEvents.map((event) => (
                <EventCard
                  key={event.id}
                  eventName={event.name}
                  eventType={event.type}
                  eventDate={event.date}
                  venue={event.venue}
                  artistName={event.artistName}
                  eventMbid={event.id}
                />
              ))}
            </div>
          ) : (
            <div className="text-center" style={{ margin: "3rem 0" }}>
              <p style={{ fontSize: "1.2rem", color: "#666" }}>
                No upcoming events found for {activeUser}&apos;s top artists
                this month.
              </p>
              <p style={{ color: "#999" }}>
                Try a different username or time range!
              </p>
            </div>
          )}

          {/* Per-Artist Breakdown */}
          {artistsWithEvents && artistsWithEvents.length > 0 && (
            <div className="events-by-artist">
              <h3>By Artist</h3>
              <div className="artist-event-list">
                {artistsWithEvents.map((artist) => (
                  <div key={artist.artistMbid} className="artist-event-row">
                    <div className="artist-event-name">
                      <a
                        href={`https://musicbrainz.org/artist/${artist.artistMbid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {artist.artistName}
                      </a>
                      <small> ({artist.listenCount} listens this month)</small>
                    </div>
                    <div className="artist-event-count">
                      {artist.events.length > 0 ? (
                        <Pill active type="secondary">
                          {artist.events.length} event
                          {artist.events.length > 1 ? "s" : ""}
                        </Pill>
                      ) : (
                        <span className="text-muted">No upcoming events</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
