import * as React from "react";
import { faCalendar, faMapMarkerAlt } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Pill from "../../../components/Pill";

type EventCardProps = {
  eventName: string;
  eventType: string;
  eventDate: string;
  venue: string;
  artistName: string;
  eventMbid: string;
};

export default function EventCard(props: EventCardProps) {
  const { eventName, eventType, eventDate, venue, artistName, eventMbid } =
    props;

  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const isUpcoming = new Date(eventDate) >= new Date();

  return (
    <div className="event-card">
      <div className="event-card-header">
        <Pill active type="secondary">
          {eventType || "Event"}
        </Pill>
        {isUpcoming && (
          <span className="event-upcoming-badge">Upcoming</span>
        )}
      </div>

      <div className="event-card-body">
        <h4 className="event-card-title">
          <a
            href={`https://musicbrainz.org/event/${eventMbid}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {eventName}
          </a>
        </h4>

        <div className="event-card-artist">{artistName}</div>

        <div className="event-card-details">
          <div className="event-card-detail">
            <FontAwesomeIcon icon={faCalendar} />
            <span>{formatDate(eventDate)}</span>
          </div>
          {venue && venue !== "Unknown Venue" && (
            <div className="event-card-detail">
              <FontAwesomeIcon icon={faMapMarkerAlt} />
              <span>{venue}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
