import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Clock, Zap, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
  const [hoveredDepth, setHoveredDepth] = useState<number | null>(null);

  const depthLevels = [
    {
      level: 1,
      icon: "⚡",
      title: "Basic Search",
      duration: "45s",
      description: "Quick surface-level scan across primary databases",
      color: "from-blue-500 to-blue-600",
      borderColor: "border-blue-500/50",
      hoverColor: "hover:border-blue-400",
      glowColor: "shadow-blue-500/50",
      badgeColor: "bg-blue-500/20 text-blue-300",
    },
    {
      level: 2,
      icon: "🔎",
      title: "Enhanced",
      duration: "90s",
      description: "Deeper investigation with relationship mapping",
      color: "from-purple-500 to-purple-600",
      borderColor: "border-purple-500/50",
      hoverColor: "hover:border-purple-400",
      glowColor: "shadow-purple-500/50",
      badgeColor: "bg-purple-500/20 text-purple-300",
    },
    {
      level: 3,
      icon: "📊",
      title: "Full Report",
      duration: "180s",
      description: "Comprehensive analysis with historical data",
      color: "from-orange-500 to-orange-600",
      borderColor: "border-orange-500/50",
      hoverColor: "hover:border-orange-400",
      glowColor: "shadow-orange-500/50",
      badgeColor: "bg-orange-500/20 text-orange-300",
    },
    {
      level: 4,
      icon: "👁️",
      title: "EYE OF GOD",
      duration: "300s",
      description: "Total omniscience—maximum depth, all sources, complete intelligence",
      color: "from-red-500 to-red-600",
      borderColor: "border-red-500/50",
      hoverColor: "hover:border-red-400",
      glowColor: "shadow-red-500/50",
      badgeColor: "bg-red-500/20 text-red-300",
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

  const getSelectedDepthInfo = () => {
    return depthLevels.find(d => d.level === selectedDepth);
  };

  return (
    <div className="space-y-6">
      {/* Selected Depth Indicator */}
      <div className="text-center">
        <Badge variant="outline" className={`text-sm px-4 py-2 ${getSelectedDepthInfo()?.badgeColor} border-2`}>
          <Clock className="w-4 h-4 mr-2 inline" />
          Selected: {getSelectedDepthInfo()?.title} (~{getSelectedDepthInfo()?.duration})
        </Badge>
      </div>

      {/* Input Fields */}
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="pantheon-name" className="text-base font-semibold">
            Target Name *
          </Label>
          <Input
            id="pantheon-name"
            placeholder="e.g., John Smith"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isSearching}
            className="text-lg h-12 border-2 focus:ring-2"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="pantheon-location" className="text-base font-semibold">
            Location (Optional)
          </Label>
          <Input
            id="pantheon-location"
            placeholder="e.g., New York, NY"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={isSearching}
            className="text-lg h-12 border-2 focus:ring-2"
          />
        </div>
      </div>

      {/* Doomsday Clock Selector */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {depthLevels.map((depth) => {
          const isSelected = selectedDepth === depth.level;
          const isHovered = hoveredDepth === depth.level;
          const isEyeOfGod = depth.level === 4;
          
          return (
            <Card
              key={depth.level}
              className={`cursor-pointer transition-all duration-300 ease-in-out relative overflow-hidden
                ${isSelected 
                  ? `ring-4 ring-offset-2 ${isEyeOfGod ? 'ring-red-500' : 'ring-primary'} scale-105 shadow-2xl ${depth.glowColor}` 
                  : `hover:scale-[1.03] hover:shadow-xl ${depth.hoverColor} border-2`
                }
                ${isEyeOfGod ? depth.borderColor : ''}
                ${isHovered && !isSelected ? 'border-2' : ''}
                ${isSearching ? 'opacity-70' : ''}
              `}
              onClick={() => !isSearching && setSelectedDepth(depth.level)}
              onMouseEnter={() => setHoveredDepth(depth.level)}
              onMouseLeave={() => setHoveredDepth(null)}
            >
              {/* Animated Background Pulse for Selected */}
              {isSelected && (
                <div className={`absolute inset-0 bg-gradient-to-br ${depth.color} opacity-5 animate-pulse`} />
              )}
              
              {/* Selection Indicator */}
              {isSelected && (
                <div className="absolute top-2 right-2">
                  <div className={`w-3 h-3 rounded-full bg-gradient-to-br ${depth.color} animate-pulse shadow-lg`} />
                </div>
              )}
              
              <CardContent className="p-6 relative z-10">
                <div className="flex items-center justify-center mb-4">
                  <div
                    className={`text-5xl p-4 rounded-full bg-gradient-to-br ${depth.color} text-white shadow-2xl 
                      ${isSelected ? 'animate-pulse scale-110' : ''}
                      ${isHovered ? 'scale-110' : ''}
                      transition-transform duration-300
                    `}
                  >
                    {depth.icon}
                  </div>
                </div>
                
                <h3 className={`text-center font-bold mb-2 text-lg leading-tight
                  ${isEyeOfGod ? 'text-red-600 animate-pulse' : ''}
                  ${isSelected ? 'scale-105' : ''}
                  transition-all duration-300
                `}>
                  {depth.title}
                </h3>
                
                <div className="flex items-center justify-center mb-3">
                  <Clock className={`w-4 h-4 mr-1 ${isSelected ? 'animate-spin-slow' : ''}`} />
                  <p className="text-center text-sm font-semibold text-muted-foreground">
                    ~{depth.duration}
                  </p>
                </div>
                
                <p className="text-xs text-center text-muted-foreground leading-relaxed">
                  {depth.description}
                </p>
                
                {/* Level Indicator */}
                <div className="mt-4 flex items-center justify-center gap-1">
                  {[...Array(depth.level)].map((_, i) => (
                    <div
                      key={i}
                      className={`h-1 w-6 rounded-full bg-gradient-to-r ${depth.color} 
                        ${isSelected ? 'animate-pulse' : ''}
                      `}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Search Button with Enhanced Styling */}
      <Button
        onClick={handleSearch}
        disabled={isSearching || !name.trim()}
        className={`w-full h-14 text-lg font-bold transition-all duration-300
          ${!isSearching && name.trim() 
            ? 'bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 shadow-xl hover:shadow-2xl hover:scale-[1.02]' 
            : ''
          }
        `}
        size="lg"
      >
        {isSearching ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            <span className="animate-pulse">Searching Intelligence Sources...</span>
          </>
        ) : (
          <>
            {selectedDepth === 4 ? (
              <Eye className="w-5 h-5 mr-2 animate-pulse" />
            ) : (
              <Zap className="w-5 h-5 mr-2" />
            )}
            Initiate PANTHEON Search
          </>
        )}
      </Button>
      
      {/* Helper Text */}
      {!name.trim() && (
        <p className="text-center text-sm text-muted-foreground animate-pulse">
          Enter a target name to begin
        </p>
      )}
    </div>
  );
}
