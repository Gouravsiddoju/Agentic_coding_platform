import { useState, useRef, useEffect } from 'react'
import { Send, Terminal, Code2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { motion, AnimatePresence } from 'framer-motion'
import './App.css'

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: '**Welcome to OPTCode Desktop.** How can I help you build software today?' }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    let ws: WebSocket;
    try {
      ws = new WebSocket('ws://localhost:8007/ws/chat');
      
      ws.onopen = () => {
        console.log('Connected to OPTCode API');
        setConnected(true);
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'message') {
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: data.role || 'assistant',
              content: data.content
            }]);
            setIsProcessing(false);
          } else if (data.type === 'system' || data.type === 'error') {
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'system',
              content: data.content
            }]);
            if (data.type === 'error') setIsProcessing(false);
          } else if (data.type === 'tool_call') {
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              role: 'tool',
              content: `🔧 Calling: ${data.func_name}(${JSON.stringify(data.args).slice(0, 120)}...)`
            }]);
          } else if (data.type === 'status') {
            setStatus(data.content);
          }
        } catch (e) {
          console.error('Error parsing WS message:', e);
        }
      };
      
      ws.onclose = () => {
        console.log('Disconnected from API');
        setConnected(false);
      };
      
      ws.onerror = () => {
        setConnected(false);
      };

      wsRef.current = ws;
    } catch {
      setConnected(false);
    }
    
    return () => {
      if (ws) ws.close();
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isProcessing) return;
    
    const newUserMsg: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, newUserMsg]);
    setIsProcessing(true);
    setStatus('Sending to backend...');
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(input);
    } else {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'system',
        content: '⚠️ Cannot connect to the Python backend. Make sure `python api.py` is running.'
      }]);
      setIsProcessing(false);
    }
    
    setInput('');
  };

  return (
    <div className="flex h-screen bg-surface-900 text-surface-50 overflow-hidden">
      
      {/* Sidebar */}
      <div className="w-64 bg-surface-800 border-r border-surface-700 flex flex-col shrink-0">
        {/* Logo */}
        <div className="p-4 border-b border-surface-700 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-500 flex items-center justify-center"
               style={{ boxShadow: '0 0 20px rgba(249,115,22,0.4)' }}>
            <Code2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-white">OPTCode</h1>
            <p className="text-[10px] text-surface-400 -mt-0.5">Desktop v2.0</p>
          </div>
        </div>
        
        {/* Connection Status */}
        <div className="px-4 py-3 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} 
                 style={{ boxShadow: connected ? '0 0 6px rgba(74,222,128,0.6)' : '0 0 6px rgba(248,113,113,0.6)' }} />
            <span className="text-xs text-surface-400">
              {connected ? 'Backend Connected' : 'Backend Offline'}
            </span>
          </div>
        </div>

        {/* Agent Status */}
        <div className="p-4 flex-1 overflow-y-auto">
          <h2 className="text-[11px] font-semibold text-surface-500 uppercase tracking-widest mb-4">Agent Status</h2>
          
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                   style={{ backgroundColor: 'rgba(249,115,22,0.15)' }}>
                <Terminal className="w-3.5 h-3.5 text-brand-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-surface-200">Orchestrator</p>
                <p className="text-[11px] text-brand-400 truncate max-w-[140px]">{status}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-full bg-surface-700 flex items-center justify-center shrink-0">
                <Code2 className="w-3.5 h-3.5 text-surface-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-surface-200">Engineer</p>
                <p className="text-[11px] text-surface-500">Waiting for plan</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-700">
          <p className="text-[10px] text-surface-600 text-center">Powered by GPT-4o</p>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <AnimatePresence>
            {messages.map((msg) => (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div 
                  className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user' 
                      ? 'bg-brand-600 text-white rounded-br-sm' 
                      : msg.role === 'tool'
                      ? 'bg-surface-800 text-surface-300 font-mono text-xs border border-surface-700 rounded-lg'
                      : msg.role === 'system'
                      ? 'bg-surface-700/50 text-surface-300 text-sm italic rounded-full py-2 px-5 border border-surface-600/50'
                      : 'bg-surface-800 text-surface-100 rounded-bl-sm border border-surface-700'
                  }`}
                >
                  <div className="text-sm leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0 [&_code]:bg-surface-900 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-brand-300 [&_code]:text-xs [&_pre]:bg-surface-900 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-surface-700 [&_strong]:text-white [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isProcessing && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2.5 items-center text-surface-400 text-sm px-2 py-1">
              <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              <span>{status}</span>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-surface-700" style={{ backgroundColor: 'rgba(15,23,42,0.85)', backdropFilter: 'blur(12px)' }}>
          <div className="max-w-4xl mx-auto relative flex items-center">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask OPTCode to build something..."
              className="w-full bg-surface-800 border border-surface-600 rounded-xl py-3 pl-4 pr-12 text-sm text-surface-50 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none transition-shadow"
              style={{ height: '52px' }}
              rows={1}
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isProcessing}
              className="absolute right-2 p-2 bg-brand-500 text-white rounded-lg transition-colors hover:bg-brand-600 disabled:bg-surface-700 disabled:text-surface-500 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
