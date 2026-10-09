import type { Metadata } from "next";
import { CommunityTabs } from "@/components/community/community-tabs";
import { PageHeader } from "@/components/ui/primitives";
import { getCurrentUser, getFeed, getLeaderboard, searchPeople } from "@/lib/queries";

export const metadata: Metadata = { title: "Community" };

export default async function CommunityPage() {
  const user = await getCurrentUser();
  const [feed, leaderboard, friends] = await Promise.all([
    getFeed(user.id),
    getLeaderboard(user.id),
    searchPeople(user.id),
  ]);

  return (
    <>
      <PageHeader eyebrow="Friends" title="Community" />
      <CommunityTabs feed={feed} leaderboard={leaderboard} friends={friends} />
    </>
  );
}
