import { VOCABULARY_SOURCE_DISPLAY_NAMES } from "@/lib/vocabulary/catalog";
import type { VocabularyRecord } from "@/lib/vocabulary/schema";
import { listApprovedProductionVocabularyRecords } from "@/lib/vocabulary/production";

export function DataSourcesPageContent({ records }: { records: VocabularyRecord[] }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-title-lg font-medium text-heading">Data sources</h1>
      <p className="mt-3 text-body leading-relaxed text-text-muted">
        Peer lists only locally verified vocabulary assets here. Each published entry identifies its reviewed release, license, attribution, and local modification status.
      </p>
      {records.length === 0 ? (
        <p className="mt-8 rounded-2xl bg-surface p-5 text-body text-text-muted shadow-card">
          No reviewed vocabulary assets are installed yet. Source names in Peer&apos;s import policy are not imports or evidence of a reviewed release.
        </p>
      ) : (
        <ul className="mt-8 space-y-4" aria-label="Verified vocabulary sources">
          {records.map((record) => (
            <li key={`${record.sourceId}:${record.releaseId}`} className="rounded-2xl bg-surface p-5 shadow-card">
              <h2 className="text-title text-heading">{VOCABULARY_SOURCE_DISPLAY_NAMES[record.sourceId]}</h2>
              <p className="mt-1 text-meta text-text-muted">Release: {record.releaseId}</p>
              <p className="mt-3 text-body text-text-muted">{record.description}</p>
              <p className="mt-3 text-meta text-text-muted">{record.attribution}</p>
              <p className="mt-2 text-meta text-text-faint">Modified locally: {record.modified ? "yes" : "no"}</p>
              <a href={record.sourceUri} rel="noopener noreferrer" target="_blank" className="mt-3 inline-block text-meta text-accent underline">Source: {record.sourceUri}</a>
              <a href={record.licenseUrl} rel="noopener noreferrer" target="_blank" className="mt-1 inline-block text-meta text-accent underline">License: {record.licenseName}</a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default async function DataSourcesPage() {
  return <DataSourcesPageContent records={await listApprovedProductionVocabularyRecords()} />;
}
