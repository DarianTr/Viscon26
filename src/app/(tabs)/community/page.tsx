import type { Metadata } from "next";
import { CommunityTabs } from "@/components/community/community-tabs";
import { PageHeader } from "@/components/ui/primitives";
import { listChallenges } from "@/lib/challenges";
import { getCurrentUser, getFeed, getLeaderboard, searchPeople } from "@/lib/queries";

export const metadata: Metadata = { title: "Community" };

export default async function CommunityPage({ searchParams }: PageProps<"/community">) {
  const user = await getCurrentUser();
  const { tab } = await searchParams;
  const [feed, mine, leaderboard, friends, challenges] = await Promise.all([
    getFeed(user.id),
    getFeed(user.id, { mineOnly: true, limit: 50 }),
    getLeaderboard(user.id),
    searchPeople(user.id),
    listChallenges(user.id),
  ]);

  return (
    <>
      <PageHeader eyebrow="Friends" title="Community" />
      <CommunityTabs
        feed={feed}
        mine={mine}
        leaderboard={leaderboard}
        friends={friends}
        challenges={challenges}
        initialTab={typeof tab === "string" ? tab : undefined}
      />
    </>
  );
}
