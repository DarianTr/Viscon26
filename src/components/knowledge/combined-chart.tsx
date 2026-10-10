"use client";

import { useState } from "react";
import type { KnowledgeSubject, Timeline } from "@/lib/knowledge";
import { ForecastChart, Segmented } from "./forecast-chart";
import { TopicProfile } from "./topic-profile";

const ALL = "all";

/** Switches between the plan-wide subject comparison and an individual forecast. */
export function CombinedChart({ timeline, subjects }: { timeline: Timeline; subjects: KnowledgeSubject[] }) {
  const [subjectId, setSubjectId] = useState(ALL);
  const selectedSubject = subjects.find((subject) => subject.id === subjectId);

  return (
    <div className="space-y-4">
      <Segmented
        label="Subject"
        value={subjectId}
        onChange={setSubjectId}
        options={[{ value: ALL, label: "All subjects" }, ...subjects.map((subject) => ({ value: subject.id, label: subject.name }))]}
      />
      {selectedSubject ? (
        <>
          <ForecastChart key={selectedSubject.id} timeline={timeline} subjects={subjects} initialSubjectId={selectedSubject.id} showSubjectSelector={false} />
          <TopicProfile key={`topics-${selectedSubject.id}`} timeline={timeline} subjects={subjects} initialSubjectId={selectedSubject.id} showSubjectSelector={false} showRadar={false} />
        </>
      ) : (
        <TopicProfile timeline={timeline} subjects={subjects} showSubjectSelector={false} showProgressList={false} />
      )}
    </div>
  );
}
