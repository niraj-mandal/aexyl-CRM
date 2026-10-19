/** One color per stage, shared by the dashboard, Leads and Pipeline so they read as one system. */
export const DEAL_STAGES = [
  { key: "QUALIFIED", label: "Qualified", color: "#9B9BA4" },
  { key: "CALL_BOOKED", label: "Call booked", color: "#F5C84C" },
  { key: "PROPOSAL", label: "Proposal", color: "#2B66FF" },
  { key: "NEGOTIATION", label: "Negotiation", color: "#E5322D" },
  { key: "WON", label: "Won", color: "#2FA36B" },
  { key: "LOST", label: "Lost", color: "#5A5A63" },
];

export const LEAD_STAGE: Record<string, { label: string; color: string }> = {
  NEW: { label: "New", color: "#9B9BA4" },
  CONTACTED: { label: "Contacted", color: "#F5C84C" },
  QUALIFIED: { label: "Interested", color: "#2FA36B" },
  NURTURE: { label: "Nurture", color: "#8B7CF6" },
  CONVERTED: { label: "Won", color: "#1F7A4D" },
  LOST: { label: "Lost", color: "#E5322D" },
  UNQUALIFIED: { label: "Unqualified", color: "#5A5A63" },
};

export const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
