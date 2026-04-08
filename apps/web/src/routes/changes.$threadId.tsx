import { ThreadId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { ChangesWindow, type ChangesWindowProps } from "../components/ChangesPanel";
import { parseChangesWindowSearch } from "../lib/changesWindow";

function ChangesWindowRoute() {
  const search = Route.useSearch();
  const params = Route.useParams();

  const props: ChangesWindowProps = {
    threadId: ThreadId.makeUnsafe(params.threadId),
    initialPath: search.path,
    initialMode: search.mode,
  };

  return <ChangesWindow {...props} />;
}

export const Route = createFileRoute("/changes/$threadId")({
  validateSearch: (search) => parseChangesWindowSearch(search),
  component: ChangesWindowRoute,
});
