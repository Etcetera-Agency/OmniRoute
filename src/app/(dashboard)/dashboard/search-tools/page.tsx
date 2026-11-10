import { Suspense } from "react";
import SearchToolsClient from "./SearchToolsClient";

export default function SearchToolsPage() {
  return (
    <Suspense>
      <SearchToolsClient />
    </Suspense>
  );
}
