"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";

// Mirrors the server's limit so the textarea stops where the API would
// refuse; the server remains the authority.
const MAX_TEXT_LENGTH = 20000;

// How long after the last keystroke a save is sent.
const DEBOUNCE_MS = 800;

const GENERIC_SAVE_FAILURE =
  "Unable to save the notes. Your text is kept here; keep typing or click away to retry.";
const GENERIC_LOAD_FAILURE = "Unable to load the shared notes.";

// A notes state as the server sends it (GET/PUT response or broadcast).
function isNotesState(value) {
  return (
    !!value &&
    typeof value.text === "string" &&
    value.text.length <= MAX_TEXT_LENGTH &&
    Number.isInteger(value.version) &&
    value.version >= 0
  );
}

// The room's one shared notes pad. MongoDB is the source of truth: every
// text shown here either came from the API or is the user's own unsaved
// typing on its way there. Saves are debounced, sent one at a time, and the
// server broadcasts the saved result to everyone else on the room channel
// (which RoomMembers owns; events reach this component through
// registerHandlers, never through a channel of its own).
export default function NotesPad({ roomId, canEdit, registerHandlers }) {
  const { refreshUser } = useAuth();
  const router = useRouter();

  const [text, setText] = useState("");
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Refs hold the truth that async work reads; state above only drives the
  // render. Everything is per room because the page keys this component by
  // room id, so a new room is a fresh instance.
  const textRef = useRef(""); // latest local text
  const versionRef = useRef(0); // highest authoritative version known
  const dirtyRef = useRef(false); // local edits not yet saved
  const generationRef = useRef(0); // bumps on every local edit
  const inFlightRef = useRef(false); // a PUT is running
  const pendingRef = useRef(false); // edits arrived while a PUT was running
  const remoteCountRef = useRef(0); // newer broadcasts seen; guards GET replies
  const heldRemoteRef = useRef(null); // newest remote state kept back while dirty
  const debounceRef = useRef(null);
  const activeRef = useRef(false); // mounted; blocks state updates after unmount

  // Shows a remote state, unless the user has unsaved text: then it is held
  // back so typing is never disturbed, and settled once the save completes
  // (see save). A held state is replaced only by a newer one.
  const show = useCallback((next) => {
    if (dirtyRef.current) {
      if (!heldRemoteRef.current || next.version > heldRemoteRef.current.version) {
        heldRemoteRef.current = next;
      }
      return;
    }

    heldRemoteRef.current = null;
    textRef.current = next.text;
    setText(next.text);
  }, []);

  // A broadcast is applied only if strictly newer than the highest version
  // known; older or equal ones are late deliveries or duplicates.
  const acceptBroadcast = useCallback(
    (next) => {
      if (next.version <= versionRef.current) {
        return;
      }
      versionRef.current = next.version;
      remoteCountRef.current += 1;
      show(next);
    },
    [show]
  );

  // A read comes straight from MongoDB and its caller already dropped it if
  // a newer broadcast overtook it, so it cannot be stale: it re-bases the
  // version (even downward, which only happens if a broadcast ever carried
  // a version MongoDB never issued) and is shown.
  const acceptRead = useCallback(
    (next) => {
      versionRef.current = next.version;
      show(next);
    },
    [show]
  );

  const handleBroadcast = useCallback(
    (payload) => {
      if (isNotesState(payload)) {
        acceptBroadcast(payload);
      }
    },
    [acceptBroadcast]
  );

  // One authoritative read: on mount and again whenever the room channel
  // reports SUBSCRIBED (first join and every reconnect), so anything missed
  // while not subscribed is picked up. A reply that a newer broadcast
  // overtook while in flight is discarded.
  const loadNotes = useCallback(async () => {
    const seen = remoteCountRef.current;
    const result = await apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/notes`);

    if (!activeRef.current) {
      return;
    }

    if (result.ok) {
      if (remoteCountRef.current === seen && isNotesState(result.data.notes)) {
        acceptRead(result.data.notes);
      }
      setLoadState("ready");
      setLoadError(null);
      return;
    }

    if (result.status === 401) {
      await refreshUser();
      router.replace("/login");
      return;
    }

    // Only the first load reports a failure; a failed re-sync leaves the
    // last known state in place.
    setLoadState((current) => (current === "loading" ? "error" : current));
    setLoadError(
      result.status === 403 && result.data.message
        ? result.data.message
        : GENERIC_LOAD_FAILURE
    );
  }, [roomId, acceptRead, refreshUser, router]);

  // Saves the latest local text. Only one PUT runs at a time; edits made
  // meanwhile are remembered and sent when it finishes (the loop). The
  // editor is marked clean only if no edit happened since this request
  // captured its text, so an older response can never hide newer typing.
  const save = useCallback(async () => {
    inFlightRef.current = true;
    setSaving(true);

    for (;;) {
      const generation = generationRef.current;
      const result = await apiFetch(
        `/api/rooms/${encodeURIComponent(roomId)}/notes`,
        { method: "PUT", body: { text: textRef.current } }
      );

      if (!activeRef.current) {
        inFlightRef.current = false;
        return;
      }

      if (result.ok) {
        const saved = result.data.notes;
        if (isNotesState(saved)) {
          versionRef.current = saved.version;
        }
        if (generationRef.current === generation) {
          dirtyRef.current = false;
          setDirty(false);
          setSaveError(null);

          // A remote state held back while this text was unsaved: if it
          // committed after this save it is what MongoDB holds now, so it
          // takes over; if this save committed later, this text won and
          // the held state is dropped. Last writer wins, consistently.
          const held = heldRemoteRef.current;
          heldRemoteRef.current = null;
          if (held && isNotesState(saved) && held.version > saved.version) {
            versionRef.current = held.version;
            show(held);
          }
        }
      } else if (result.status === 401) {
        inFlightRef.current = false;
        setSaving(false);
        await refreshUser();
        router.replace("/login");
        return;
      } else {
        // The text stays in the editor and stays dirty; the next keystroke
        // or blur tries again. 400/403/404 messages are written for users.
        const safe = result.status === 400 || result.status === 403 || result.status === 404;
        setSaveError(safe && result.data.message ? result.data.message : GENERIC_SAVE_FAILURE);
      }

      if (!(pendingRef.current && dirtyRef.current)) {
        break;
      }
      pendingRef.current = false;
    }

    pendingRef.current = false;
    inFlightRef.current = false;
    setSaving(false);
  }, [roomId, show, refreshUser, router]);

  // Sends now if there is something to send and nothing is already running.
  const flush = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!dirtyRef.current) {
      return;
    }
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }
    save();
  }, [save]);

  function handleChange(event) {
    const value = event.target.value;

    textRef.current = value;
    generationRef.current += 1;
    dirtyRef.current = true;
    setText(value);
    setDirty(true);

    // Every keystroke restarts the wait.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(flush, DEBOUNCE_MS);
  }

  useEffect(() => {
    if (!canEdit) {
      return undefined;
    }

    activeRef.current = true;

    const unregister = registerHandlers({
      onRemote: handleBroadcast,
      resync: loadNotes,
    });

    // Leaving the page: a best-effort save that may outlive the page. No
    // response is awaited and nothing is updated afterwards.
    const flushOnLeave = () => {
      if (dirtyRef.current) {
        apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/notes`, {
          method: "PUT",
          body: { text: textRef.current },
          keepalive: true,
        });
      }
    };
    window.addEventListener("pagehide", flushOnLeave);

    // Deferred a tick so state updates happen in a callback, and so a
    // Strict Mode mount that is immediately cleaned up never fires a read.
    const initialLoad = setTimeout(loadNotes, 0);

    return () => {
      activeRef.current = false;
      clearTimeout(initialLoad);
      window.removeEventListener("pagehide", flushOnLeave);
      unregister();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      flushOnLeave();
    };
  }, [roomId, canEdit, registerHandlers, handleBroadcast, loadNotes]);

  if (!canEdit) {
    return (
      <div
        className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        data-testid="notes-pad"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Shared Notes
        </h2>
        <p className="mt-2 text-xs text-zinc-500" data-testid="notes-hint">
          Join this room to see and edit the shared notes
        </p>
      </div>
    );
  }

  const status =
    loadState === "loading"
      ? "Loading notes..."
      : loadState === "error"
        ? null
        : saving
          ? "Saving..."
          : dirty
            ? "Unsaved changes"
            : "Saved";

  return (
    <div
      className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      data-testid="notes-pad"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Shared Notes
        </h2>
        {status ? (
          <span className="text-xs text-zinc-500" data-testid="notes-status" aria-live="polite">
            {status}
          </span>
        ) : null}
      </div>

      {loadState === "error" ? (
        <p className="mt-3 text-sm text-red-600" role="alert" data-testid="notes-load-error">
          {loadError}
        </p>
      ) : (
        <>
          <label htmlFor="shared-notes" className="sr-only">
            Shared notes
          </label>
          <textarea
            id="shared-notes"
            className="mt-3 w-full resize-y rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
            rows={8}
            maxLength={MAX_TEXT_LENGTH}
            placeholder="Shared notes for this room - everyone in the room sees what you type here"
            value={text}
            onChange={handleChange}
            onBlur={flush}
            disabled={loadState !== "ready"}
            data-testid="notes-textarea"
          />
          <p className="mt-1 text-right text-xs text-zinc-500" data-testid="notes-count">
            {text.length} / {MAX_TEXT_LENGTH}
          </p>
        </>
      )}

      {saveError ? (
        <p className="mt-2 text-sm text-red-600" role="alert" data-testid="notes-error">
          {saveError}
        </p>
      ) : null}
    </div>
  );
}
