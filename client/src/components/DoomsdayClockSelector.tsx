import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface DoomsdayClockSelectorProps {
  onSearchStart: (config: SearchConfig) => void;
  isSearching?: boolean;
}

interface SearchConfig {
  name: string;
  location?: string;
  searchDepth: number;
}

export function DoomsdayClockSelector({ onSearchStart, isSearching = false }: DoomsdayClockSelectorProps) {
  const [selectedDepth, setSelectedDepth] = useState<number>(1);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");

  const depthLevels = [
    {
      level: 1,
      icon: "⚡",
      title: "Basic Search",
      duration: "30s",
      description: "Quick surface-level scan across primary databases",
      color: "from-blue-500 to-blue-600",
    },
    {
      level: 2,
      icon: "🔎",
      title: "Enhanced",
      duration: "60s",
      description: "Deeper investigation with relationship mapping",
      color: "from-purple-500 to-purple-600",
    },
    {
      level: 3,
      icon: "📊",
      title: "Full Report",
      duration: "120s",
      description: "Comprehensive analysis with historical data",
      color: "from-orange-500 to-orange-600",
    },
    {
      level: 4,
      icon: "👁️",
      title: "EYE OF GOD",
      duration: "180s",
      description: "Total omniscience—maximum depth, all sources, complete intelligence",
      color: "from-red-500 to-red-600",
    },
  ];

  const handleSearch = () => {
    if (!name.trim()) {
      return;
    }
    
    onSearchStart({
      name: name.trim(),
      location: location.trim() || undefined,
      searchDepth: selectedDepth,
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isSearching) {
      handleSearch();
    }
  };

  return (
    <div className="space-y-6">
      {/* Input Fields */}
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="pantheon-name">Target Name *</Label>
          <Input
            id="pantheon-name"
            placeholder="e.g., John Smith"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isSearching}
            className="text-lg"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="pantheon-location">Location (Optional)</Label>
          <Input
            id="pantheon-location"
            placeholder="e.g., New York, NY"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isSearching}
          />
        </div>
      </div>

      {/* Doomsday Clock Selector */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {depthLevels.map((depth) => (
          <Card
            key={depth.level}
            className={`cursor-pointer transition-all duration-200 ${
              selectedDepth === depth.level
                ? `ring-2 ring-offset-2 ${depth.level === 4 ? 'ring-red-500' : 'ring-primary'} scale-105`
                : 'hover:scale-102 hover:shadow-md'
            } ${depth.level === 4 ? 'border-red-500/50' : ''}`}
            onClick={() => !isSearching && setSelectedDepth(depth.level)}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-center mb-2">
                <div
                  className={`text-4xl p-3 rounded-full bg-gradient-to-br ${depth.color} text-white`}
                >
                  {depth.icon}
                </div>
              </div>
              <h3 className={`text-center font-bold mb-1 ${depth.level === 4 ? 'text-red-600' : ''}`}>
                {depth.title}
              </h3>
              <p className="text-center text-sm text-muted-foreground mb-2">
                ~{depth.duration}
              </p>
              <p className="text-xs text-center text-muted-foreground">
                {depth.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search Button */}
      <Button
        onClick={handleSearch}
        disabled={isSearching || !name.trim()}
        className="w-full"
        size="lg"
      >
        {isSearching ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Searching Intelligence Sources...
          </>
        ) : (
          <>
            🔍 Initiate PANTHEON Search
          </>
        )}
      </Button>
    </div>
  );
}
