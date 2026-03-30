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
  isPast: boolean;
};

type MBArtist = {
  id: string;
  name: string;
  "sort-name": string;
  disambiguation?: string;
  country?: string;
};

type FetchResult = {
  artist: MBArtist;
  upcomingEvents: ParsedEvent[];
  pastEvents: ParsedEvent[];
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

function parseEvents(events: MBEvent[], artistName: string): ParsedEvent[] {
  const today = new Date().toISOString().split("T")[0];

  return events
    .filter((event: MBEvent) => !event.cancelled)
    .map((event: MBEvent) => {
      const relations = event.relations || [];
      const heldAtRel = relations.find(
        (rel) => rel.type === "held at" && rel.place
      );
      const venue = heldAtRel?.place?.name || "Unknown Venue";
      const beginDate = event["life-span"]?.begin || "";

      return {
        id: event.id,
        name: event.name,
        type: event.type || "Event",
        date: beginDate,
        venue,
        artistName,
        isPast: beginDate < today,
      };
    });
}

async function fetchAllPages(
  artistMbid: string,
  artistName: string
): Promise<ParsedEvent[]> {
  const allEvents: ParsedEvent[] = [];
  let offset = 0;
  const limit = 100;
  let totalCount = 1; // will be updated after first fetch

  while (offset < totalCount && offset < 300) {
    const url = `${MB_API_URL}/event?artist=${artistMbid}&fmt=json&limit=${limit}&offset=${offset}`;
    try {
      const response = await rateLimitedFetch(url);
      if (!response.ok) break;

      const data = await response.json();
      totalCount = data["event-count"] || 0;
      const events = (data.events || []) as MBEvent[];
      if (events.length === 0) break;

      const parsed = parseEvents(events, artistName);
      allEvents.push(...parsed);
      offset += limit;
    } catch {
      break;
    }
  }

  return allEvents;
}

export default function LiveEvents() {
  const [filterType, setFilterType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeQuery, setActiveQuery] = useState<string>("");

  const handleSearch = useCallback(() => {
    const trimmed = searchQuery.trim();
    if (trimmed) {
      setActiveQuery(trimmed);
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

  const fetchArtistEvents = useCallback(async (): Promise<FetchResult> => {
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

    const artist = artists[0];

    // Step 2: Fetch ALL events (paginated) for this artist
    const allEvents = await fetchAllPages(artist.id, artist.name);

    // Step 3: Split into upcoming and past
    const upcomingEvents = allEvents
      .filter((e) => !e.isPast)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const pastEvents = allEvents
      .filter((e) => e.isPast)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return { artist, upcomingEvents, pastEvents };
  }, [activeQuery]);

  const { data: result, isLoading, isError, error } = useQuery<FetchResult>({
    queryKey: ["live-events-artist", activeQuery],
    queryFn: fetchArtistEvents,
    enabled: !!activeQuery,
  });

  const showingUpcoming =
    result && result.upcomingEvents && result.upcomingEvents.length > 0;
  const displayEvents = showingUpcoming
    ? result?.upcomingEvents || []
    : result?.pastEvents || [];

  // Get unique event types for filter pills
  const eventTypes = React.useMemo(() => {
    const types = new Set(displayEvents.map((e) => e.type));
    return ["all", ...Array.from(types)];
  }, [displayEvents]);

  const filteredEvents = React.useMemo(() => {
    if (filterType === "all") return displayEvents;
    return displayEvents.filter((e) => e.type === filterType);
  }, [displayEvents, filterType]);

  return (
    <div role="main">
      <Helmet>
        <title>Live Events</title>
      </Helmet>

      <div className="listen-header">
        <h2 className="header-with-line">
          Live Events
          <span className="header-subtitle">
            Discover concerts &amp; events for any artist
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
            placeholder="Search for an artist (e.g. Coldplay, Metallica, Ed Sheeran)..."
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
              Find Events
            </button>
          </span>
        </div>
        <p
          className="text-center text-muted"
          style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}
        >
          Search any artist to find their concerts and events from MusicBrainz.
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
            &apos;s events...
            <br />
            <small>
              (Fetching all pages — this may take a few seconds due to rate
              limiting)
            </small>
          </p>
        </div>
      )}

      {isError && (
        <div className="alert alert-danger" role="alert">
          {(error as Error)?.message ||
            "An error occurred while fetching events."}
        </div>
      )}

      {!isLoading && !isError && result && (
        <>
          {/* Artist Info + Stats */}
          <div className="events-summary">
            <div className="events-stat" style={{ flex: 2 }}>
              <span
                className="events-stat-number"
                style={{ fontSize: "1.5rem" }}
              >
                <a
                  href={`https://musicbrainz.org/artist/${result.artist.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#eb743b", textDecoration: "none" }}
                >
                  {result.artist.name}
                </a>
              </span>
              <span className="events-stat-label">
                {result.artist.disambiguation
                  ? result.artist.disambiguation
                  : "Artist"}
                {result.artist.country ? ` · ${result.artist.country}` : ""}
              </span>
            </div>
            <div className="events-stat">
              <span className="events-stat-number">
                {result.upcomingEvents.length}
              </span>
              <span className="events-stat-label">Upcoming</span>
            </div>
            <div className="events-stat">
              <span className="events-stat-number">
                {result.pastEvents.length}
              </span>
              <span className="events-stat-label">Past Events</span>
            </div>
          </div>

          {/* Section Header — Upcoming vs Past */}
          <div
            style={{
              textAlign: "center",
              margin: "1.5rem 0 0.5rem",
            }}
          >
            {showingUpcoming ? (
              <h3 style={{ color: "#2ecc71" }}>&#127911; Upcoming Events</h3>
            ) : (
              <div>
                <p style={{ color: "#999", marginBottom: "0.25rem" }}>
                  No upcoming events scheduled right now.
                </p>
                <h3 style={{ color: "#eb743b" }}>
                  &#128197; Recent Past Events
                </h3>
              </div>
            )}
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
              {filteredEvents.slice(0, 30).map((event) => (
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
                No events found for <strong>{result.artist.name}</strong>.
              </p>
              <p style={{ color: "#999" }}>
                This artist may not have any events in MusicBrainz. Try another
                artist!
              </p>
            </div>
          )}

          {filteredEvents.length > 30 && (
            <p className="text-center text-muted" style={{ marginTop: "1rem" }}>
              Showing 30 of {filteredEvents.length} events.
            </p>
          )}
        </>
      )}
    </div>
  );
}
