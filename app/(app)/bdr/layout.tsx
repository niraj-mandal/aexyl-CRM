// "Run Discovery Now" is a server action on this page and can run for minutes;
// the client page can't export route config, so the limit lives here.
export const maxDuration = 300;

export default function BdrLayout({ children }: { children: React.ReactNode }) {
  return children;
}
