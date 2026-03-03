import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { ChatsList } from "../sidebar/ChatsList";
import { AvatarViewport } from "../viewport/AvatarViewport";
import { ChatWindow } from "../chat/ChatWindow";

export function PanelLayout() {
  return (
    <div className="flex-1 overflow-hidden">
      <Allotment>
        {/* Left panel - Chats list */}
        <Allotment.Pane minSize={200} preferredSize={260} maxSize={400}>
          <PanelFrame title="Chats">
            <ChatsList />
          </PanelFrame>
        </Allotment.Pane>

        {/* Center panel - 3D Avatar viewport */}
        <Allotment.Pane minSize={300}>
          <PanelFrame title="AI Companion">
            <AvatarViewport />
          </PanelFrame>
        </Allotment.Pane>

        {/* Right panel - Chat window */}
        <Allotment.Pane minSize={300} preferredSize={400}>
          <PanelFrame title="Chat Window">
            <ChatWindow />
          </PanelFrame>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}

function PanelFrame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col m-1">
      <div className="glass rounded-lg flex flex-col h-full overflow-hidden">
        {/* Panel header */}
        <div className="px-4 py-2 border-b border-surface-border flex items-center justify-between shrink-0">
          <h2 className="font-display text-sm font-semibold tracking-wider uppercase text-heartline-dim">
            {title}
          </h2>
          <div className="w-2 h-2 rounded-full bg-heartline animate-pulse-glow" />
        </div>
        {/* Panel content */}
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
