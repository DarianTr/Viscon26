import type { Metadata } from "next";
import { CommunityTabs } from "@/components/community/community-tabs";
import { PageHeader } from "@/components/ui/primitives";
import { getCurrentUser, getFeed, getLeaderboard, searchPeople } from "@/lib/queries";

export const metadata: Metadata = { title: "Community" };

export default async function CommunityPage() {
  const user = await getCurrentUser();
  const [feed, mine, leaderboard, friends] = await Promise.all([
    getFeed(user.id),
    getFeed(user.id, { mineOnly: true, limit: 50 }),
    getLeaderboard(user.id),
    searchPeople(user.id),
  ]);

  return (
    <>
      <PageHeader eyebrow="Friends" title="Community" />
      <CommunityTabs feed={feed} mine={mine} leaderboard={leaderboard} friends={friends} />
    </>
  );
}
