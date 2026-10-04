import { CrmService } from "@/services/crm.service";

export type AgentToolContext = { workspaceId: string; runId: string; agent: any };
export type AgentTool = {
  name: string;
  description: string;
  readOnly: boolean;
  execute: (ctx: AgentToolContext, args: Record<string, unknown>) => Promise<unknown>;
};

const tools: AgentTool[] = [
  { name:"crm.read", description:"Read CRM workspace context.", readOnly:true, execute: async ({workspaceId}) => CrmService.getAgentCommandBrief(workspaceId) },
  { name:"signals.read", description:"Read new outbound business signals.", readOnly:true, execute: async ({workspaceId}) => CrmService.getOutboundEvents(workspaceId,"NEW",20) },
  { name:"pipeline.read", description:"Read pipeline intelligence.", readOnly:true, execute: async ({workspaceId}) => CrmService.getOutboundIntelligence(workspaceId) },
  { name:"outreach.prepare", description:"Prepare a grounded outbound action for human approval.", readOnly:false, execute: async ({workspaceId},args) => {
    const enrollmentId=String(args.enrollmentId||"");
    if(!enrollmentId) throw new Error("enrollmentId is required.");
    const queue=await CrmService.getOutboundExecutionQueue(workspaceId,50);
    const item=queue.find((x:any)=>x.enrollmentId===enrollmentId);
    if(!item) throw new Error("Enrollment is not currently eligible for outbound preparation.");
    return { enrollmentId, recommendedChannel:item.channel, leadId:item.leadId, campaignId:item.campaignId, status:"READY_FOR_PREPARATION" };
  }},
  { name:"intelligence.read", description:"Read the executive command brief.", readOnly:true, execute: async ({workspaceId}) => CrmService.getAgentCommandBrief(workspaceId) },
];

export function getAgentTools() { return tools.map(({execute,...meta})=>meta); }
export function getAgentTool(name:string) { return tools.find(t=>t.name===name); }
