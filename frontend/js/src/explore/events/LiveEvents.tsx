import * as React from "react";
import "./LiveEvents.css";
import { useState, useCallback } from "react";
import Spinner from "react-loader-spinner";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet";
import Pill from "../../components/Pill";
import EventCard from "./components/EventCard";
import { COLOR_LB_ORANGE } from "../../utils/constants";

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

type ParsedEvent = {
  id: string;
  name: string;
  type: string;
  date: string;
  venue: string;
  artistName: string;
};

type MBArtist = {
  id: string;
  name: string;
  "sort-name": string;
  disambiguation?: string;
  country?: string;
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

function parseUpcomingEvents(
  events: MBEvent[],
  artistName: string
): ParsedEvent[] {
  const today = new Date().toISOString().split("T")[0];

  return events
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
}

export default function LiveEvents() {
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeQuery, setActiveQuery] = useState<string>("");
  const [matchedArtist, setMatchedArtist] = useState<MBArtist | null>(null);

  const handleSearch = useCallback(() => {
    const trimmed = searchQuery.trim();
    if (trimmed) {
      setActiveQuery(trimmed);
      setMatchedArtist(null);
      setFilterType("all");
    }
  }, [searchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSearch();
      }
    },
    [handleSearch]
  );

  const fetchArtistEvents = useCallback(async (): Promise<ParsedEvent[]> => {
    if (!activeQuery) {
      throw new Error("Please enter an artist name to search.");
    }

    // Step 1: Search MusicBrainz for the artist
    const searchUrl = `${MB_API_URL}/artist?query=artist:${encodeURIComponent(
      activeQuery
    )}&fmt=json&limit=5`;
    const searchResponse = await rateLimitedFetch(searchUrl);

    if (!searchResponse.ok) {
      throw new Error("Failed to search MusicBrainz. Please try again.");
    }

    const searchData = await searchResponse.json();
    const artists = (searchData.artists || []) as MBArtist[];

    if (artists.length === 0) {
      throw new Error(
        `No artist found matching "${activeQuery}". Try a different name.`
      );
    }

    // Use the top match
    const artist = artists[0];
    setMatchedArtist(artist);

    // Step 2: Fetch events for this artist
    const eventsUrl = `${MB_API_URL}/event?artist=${artist.id}&fmt=json&limit=100`;
    const eventsResponse = await rateLimitedFetch(eventsUrl);

    if (!eventsResponse.ok) {
      return [];
    }

    const eventsData = await eventsResponse.json();
    const rawEvents = (eventsData.events || []) as MBEvent[];

    return parseUpcomingEvents(rawEvents, artist.name);
  }, [activeQuery]);

  const { data: events, isLoading, isError, error } = useQuery<ParsedEvent[]>({
    queryKey: ["live-events-artist", activeQuery],
    queryFn: fetchArtistEvents,
    enabled: !!activeQuery,
  });

  const allEvents = events || [];

  // Get unique event types for filter pills
  const eventTypes = React.useMemo(() => {
    const types = new Set(allEvents.map((e) => e.type));
    return ["all", ...Array.from(types)];
  }, [allEvents]);

  const filteredEvents = React.useMemo(() => {
    if (filterType === "all") return allEvents;
    return allEvents.filter((e) => e.type === filterType);
  }, [allEvents, filterType]);

  return (
    <div role="main">
      <Helmet>
        <title>Live Events</title>
      </Helmet>

      <div className="listen-header">
        <h2 className="header-with-line">
          Live Events
          <span className="header-subtitle">
            Discover upcoming concerts &amp; events
          </span>
        </h2>
      </div>

      {/* Artist Search */}
      <div className="events-search" style={{ marginBottom: "2rem" }}>
        <div
          className="input-group"
          style={{ maxWidth: 550, margin: "0 auto" }}
        >
          <input
            type="text"
            className="form-control"
            placeholder="Search for an artist (e.g. Radiohead, Coldplay, Taylor Swift)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            id="events-artist-input"
            style={{ fontSize: "1rem", padding: "10px 14px" }}
          />
          <span className="input-group-btn">
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleSearch}
              disabled={!searchQuery.trim()}
              id="events-search-btn"
              style={{
                backgroundColor: "#eb743b",
                borderColor: "#eb743b",
                fontSize: "1rem",
                padding: "10px 20px",
              }}
            >
              <span
                className="glyphicon glyphicon-search"
                style={{ marginRight: 6 }}
              />
              Find Events
            </button>
          </span>
        </div>
        <p
          className="text-center text-muted"
          style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}
        >
          Search any artist to find their upcoming concerts and events from
          MusicBrainz.
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
            Searching MusicBrainz for <strong>{activeQuery}</strong>
            &apos;s upcoming events...
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

      {!isLoading && !isError && activeQuery && events && (
        <>
          {/* Artist Info */}
          {matchedArtist && (
            <div className="events-summary">
              <div className="events-stat" style={{ flex: 2 }}>
                <span
                  className="events-stat-number"
                  style={{ fontSize: "1.5rem" }}
                >
                  <a
                    href={`https://musicbrainz.org/artist/${matchedArtist.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#eb743b", textDecoration: "none" }}
                  >
                    {matchedArtist.name}
                  </a>
                </span>
                <span className="events-stat-label">
                  {matchedArtist.disambiguation
                    ? matchedArtist.disambiguation
                    : "Artist"}
                  {matchedArtist.country ? ` · ${matchedArtist.country}` : ""}
                </span>
              </div>
              <div className="events-stat">
                <span className="events-stat-number">{allEvents.length}</span>
                <span className="events-stat-label">Upcoming Events</span>
              </div>
            </div>
          )}

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
                No upcoming events found for{" "}
                <strong>{matchedArtist?.name || activeQuery}</strong>.
              </p>
              <p style={{ color: "#999" }}>
                This artist may not have any scheduled events in MusicBrainz
                right now. Try another artist!
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
