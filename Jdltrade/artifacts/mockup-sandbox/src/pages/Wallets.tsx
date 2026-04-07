import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Wallet, Plus, Copy, QrCode, Send, ArrowDownLeft,
  Eye, EyeOff, ExternalLink, Shield, RefreshCw,
  CheckCircle2, ArrowRight
} from "lucide-react";
import { WALLETS } from "@/lib/mockData";
import { cn } from "@/lib/utils";

const TOKEN_BALANCES = [
  { symbol: "ETH", name: "Ethereum", balance: 4.2831, usd: 13886.42, change: 2.34, color: "#627EEA" },
  { symbol: "USDC", name: "USD Coin", balance: 12450.0, usd: 12450.0, change: 0.01, color: "#2775CA" },
  { symbol: "USDT", name: "Tether", balance: 2300.0, usd: 2300.0, change: 0.02, color: "#26A17B" },
  { symbol: "WBTC", name: "Wrapped Bitcoin", balance: 0.0412, usd: 2961.82, change: 1.12, color: "#F7931A" },
];

function AddressDisplay({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}...${address.slice(-4)}`;

  const copy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className="text-gray-400">{short}</span>
      <button onClick={copy} className="text-gray-500 hover:text-white transition-colors">
        {copied ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      </button>
      <a href={`https://etherscan.io/address/${address}`} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-blue-400 transition-colors">
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

function WalletCard({ wallet, selected, onClick }: {
  wallet: typeof WALLETS[0]; selected: boolean; onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "p-4 rounded-xl border cursor-pointer transition-all",
        selected ? "border-blue-500/40 bg-blue-500/10" : "border-white/5 bg-[#0d1225] hover:border-white/15"
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-sm">{wallet.name}</div>
          <AddressDisplay address={wallet.address} />
        </div>
        <div className="flex items-center gap-2">
          <Badge className={wallet.type === "generated" ? "bg-blue-500/15 text-blue-400 border-blue-500/20" : "bg-purple-500/15 text-purple-400 border-purple-500/20"}>
            {wallet.type}
          </Badge>
          <div className="text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded">{wallet.network}</div>
        </div>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs text-gray-500">ETH Balance</div>
          <div className="text-lg font-bold font-mono">{wallet.ethBalance} ETH</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">Total USD</div>
          <div className="text-xl font-bold text-blue-400">${wallet.totalUsd.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}

function CreateWalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState("generate");
  const [created, setCreated] = useState(false);

  const mockAddress = "0x" + Array.from({length: 40}, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const mockMnemonic = "abandon ability able about above absent absorb abstract absurd abuse access accident".split(" ");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#0d1225] border-white/10 max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-blue-400" />
            Add Wallet
          </DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full bg-white/5 border border-white/10">
            <TabsTrigger value="generate" className="flex-1 text-xs">Generate New</TabsTrigger>
            <TabsTrigger value="import" className="flex-1 text-xs">Import Seed</TabsTrigger>
            <TabsTrigger value="connect" className="flex-1 text-xs">Connect Wallet</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4 mt-4">
            {created ? (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-green-500/5 border border-green-500/15">
                  <div className="text-xs text-green-400 mb-2 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Wallet Generated
                  </div>
                  <div className="font-mono text-xs text-gray-300 break-all">{mockAddress}</div>
                </div>
                <div className="p-3 rounded-xl bg-yellow-500/5 border border-yellow-500/15">
                  <div className="text-xs text-yellow-400 mb-2 flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Recovery Phrase — Store Securely
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {mockMnemonic.map((word, i) => (
                      <div key={i} className="flex items-center gap-1 text-xs">
                        <span className="text-gray-600">{i + 1}.</span>
                        <span className="font-mono text-gray-200">{word}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <Button onClick={onClose} className="w-full bg-blue-600 hover:bg-blue-700">Done</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm mb-2 block">Wallet Name</Label>
                  <Input placeholder="My New Wallet" className="bg-white/5 border-white/10" />
                </div>
                <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/15 text-xs text-blue-400">
                  A new HD wallet with BIP39 mnemonic will be generated. Your keys are encrypted and stored securely.
                </div>
                <Button onClick={() => setCreated(true)} className="w-full bg-blue-600 hover:bg-blue-700">
                  Generate Wallet
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="import" className="space-y-4 mt-4">
            <div>
              <Label className="text-sm mb-2 block">Seed Phrase (12 or 24 words)</Label>
              <textarea
                rows={4}
                placeholder="word1 word2 word3 ..."
                className="w-full rounded-lg bg-white/5 border border-white/10 text-sm text-white p-3 placeholder-gray-600 resize-none focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <Button className="w-full bg-blue-600 hover:bg-blue-700">Import Wallet</Button>
          </TabsContent>

          <TabsContent value="connect" className="space-y-3 mt-4">
            {["MetaMask", "WalletConnect", "Coinbase Wallet"].map(name => (
              <button key={name} className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/5 hover:border-blue-500/30 hover:bg-blue-500/5 transition-all text-left">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-lg">
                  {name === "MetaMask" ? "🦊" : name === "WalletConnect" ? "🔗" : "🔵"}
                </div>
                <span className="text-sm font-medium">{name}</span>
                <ArrowRight className="w-4 h-4 text-gray-500 ml-auto" />
              </button>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export function Wallets() {
  const [selectedWallet, setSelectedWallet] = useState(WALLETS[0]);
  const [showCreate, setShowCreate] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const totalUsd = WALLETS.reduce((a, b) => a + b.totalUsd, 0);

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Wallets</h1>
          <p className="text-sm text-gray-400">Total: <span className="text-white font-mono font-bold">${totalUsd.toLocaleString()}</span></p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" />
          Add Wallet
        </Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Wallet list */}
        <div className="space-y-3">
          {WALLETS.map(wallet => (
            <WalletCard
              key={wallet.id}
              wallet={wallet}
              selected={selectedWallet.id === wallet.id}
              onClick={() => setSelectedWallet(wallet)}
            />
          ))}
        </div>

        {/* Wallet detail */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="bg-[#0d1225] border-white/5">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm text-gray-400 mb-0.5">{selectedWallet.name}</div>
                  <AddressDisplay address={selectedWallet.address} />
                </div>
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>

              <div className="text-3xl font-bold font-mono mb-1">
                ${selectedWallet.totalUsd.toLocaleString()}
              </div>
              <div className="text-sm text-gray-500 mb-5">
                {selectedWallet.ethBalance} ETH · {selectedWallet.network}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-3 gap-3">
                <Button variant="outline" className="border-white/10 flex-col h-auto py-3 gap-1">
                  <Send className="w-4 h-4 text-blue-400" />
                  <span className="text-xs">Send</span>
                </Button>
                <Button variant="outline" className="border-white/10 flex-col h-auto py-3 gap-1">
                  <ArrowDownLeft className="w-4 h-4 text-green-400" />
                  <span className="text-xs">Receive</span>
                </Button>
                <Button variant="outline" className="border-white/10 flex-col h-auto py-3 gap-1">
                  <ArrowRight className="w-4 h-4 text-purple-400" />
                  <span className="text-xs">Swap</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Token Balances */}
          <Card className="bg-[#0d1225] border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Token Balances</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {TOKEN_BALANCES.map(token => (
                <div key={token.symbol} className="flex items-center gap-3 p-3 rounded-xl bg-white/3 hover:bg-white/5 transition-colors border border-white/3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: `${token.color}20` }}>
                    <div className="w-5 h-5 rounded-full" style={{ background: token.color }} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{token.symbol}</span>
                      <span className="font-mono font-bold">${token.usd.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-xs text-gray-500">{token.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 font-mono">{token.balance} {token.symbol}</span>
                        <span className={cn("text-xs font-mono", token.change >= 0 ? "text-green-400" : "text-red-400")}>
                          {token.change >= 0 ? "+" : ""}{token.change}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Security */}
          <Card className="bg-[#0d1225] border-white/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="w-4 h-4 text-yellow-400" />
                Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/3 border border-white/5">
                <div>
                  <div className="text-sm font-medium">Private Key</div>
                  <div className="text-xs text-gray-500">Encrypted with AES-256</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-gray-400 hover:text-white"
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                >
                  {showPrivateKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              {showPrivateKey && (
                <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/20">
                  <div className="text-xs text-red-400 mb-1">Never share your private key</div>
                  <div className="text-xs font-mono text-gray-400 break-all">0x••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••</div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <CreateWalletDialog open={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
