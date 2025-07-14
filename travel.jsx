"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Menu, Plus, Heart, MessageSquare, User, Send, Share, MoreVertical, ChevronDown, Star } from "lucide-react"
import Link from "next/link"

const previousTrips = [
  { name: "BHO to New Delhi Trip", liked: false },
  { name: "Budget India Trip", liked: false },
  { name: "BHO to Mumbai Weekend Trip", liked: false },
  { name: "Delhi to Bangalore Adventure", liked: true },
  { name: "Untitled trip", liked: false },
  { name: "LAX to LAS Trip", liked: false },
]

const flightResults = [
  {
    airline: "Air India",
    logo: "AI",
    departure: "6:25am - 7:55am",
    return: "4:25am - 5:45am",
    route: "BHO - DEL • 1h 30m • Nonstop",
    returnRoute: "DEL - BHO • 1h 26m • Nonstop",
    price: 82,
    badges: ["Best", "Cheapest"],
    economy: true,
  },
  {
    airline: "Air India, IndiGo",
    logo: "AI",
    departure: "6:25am - 7:55am",
    return: "5:05am - 6:30am",
    route: "BHO - DEL • 1h 30m • Nonstop",
    returnRoute: "DEL - BHO • 1h 25m • Nonstop",
    price: 87,
    badges: [],
    economy: true,
  },
]

interface TravelResultsProps {
  destination: string
}

export function TravelResults({ destination }: TravelResultsProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [message, setMessage] = useState("")
  const [activeTab, setActiveTab] = useState("Planning")

  const getDestinationInfo = (dest: string) => {
    const destinations = {
      mumbai: {
        title:
          "Search for a round-trip flight from BHO to Mumbai for 1 person departing this Friday and returning Sunday. Also search for a hotel in Mumbai for these dates.",
        route: "BHO → MUM",
      },
      delhi: {
        title:
          "Search for a round-trip flight from BHO to New Delhi for 1 person departing this Friday and returning Sunday. Also search for a hotel in New Delhi for these dates.",
        route: "BHO → DEL",
      },
      goa: {
        title: "Search for luxury accommodations in Goa for a weekend getaway, including flights from BHO to Goa.",
        route: "BHO → GOA",
      },
      bengaluru: {
        title:
          "Search for business class flights from BHO to Bengaluru for a business trip, including hotel recommendations.",
        route: "BHO → BLR",
      },
    }
    return destinations[dest as keyof typeof destinations] || destinations.delhi
  }

  const destInfo = getDestinationInfo(destination)

  return (
    <div className="flex h-screen bg-gray-900">
      {/* Sidebar */}
      <div
        className={`${sidebarOpen ? "w-80" : "w-0"} transition-all duration-300 bg-gray-800 border-r border-gray-700 flex flex-col overflow-hidden`}
      >
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-white hover:bg-gray-700"
            >
              <Menu className="w-5 h-5" />
            </Button>
            <Link href="/" className="flex items-center gap-2">
              <span className="text-white font-bold text-lg">KAYAK·ai</span>
              <Badge variant="outline" className="text-white border-gray-600 bg-transparent text-xs">
                Beta
              </Badge>
            </Link>
          </div>

          <Button className="w-full bg-gray-700 hover:bg-gray-600 text-white border-gray-600" variant="outline">
            <Plus className="w-4 h-4 mr-2" />
            Start a new plan
          </Button>
        </div>

        <div className="flex-1 p-4">
          <div className="mb-4">
            <h3 className="text-gray-400 text-sm font-medium mb-3">Previous 7 days</h3>
            <div className="space-y-2">
              {previousTrips.map((trip, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 rounded hover:bg-gray-700 cursor-pointer group"
                >
                  <span className="text-white text-sm">{trip.name}</span>
                  {trip.liked && <Heart className="w-4 h-4 text-red-500 fill-current" />}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-700">
          <Button variant="ghost" className="w-full justify-start text-gray-400 hover:text-white hover:bg-gray-700">
            <MessageSquare className="w-4 h-4 mr-2" />
            Send feedback
          </Button>

          <div className="mt-4 text-xs text-gray-500 space-y-1">
            <p>©2025 KAYAK.ai</p>
            <div className="flex gap-2">
              <a href="#" className="hover:text-gray-400">
                Privacy
              </a>
              <a href="#" className="hover:text-gray-400">
                Terms & Conditions
              </a>
            </div>
            <div className="flex gap-2">
              <a href="#" className="hover:text-gray-400">
                Ad Choices
              </a>
              <a href="#" className="hover:text-gray-400">
                How KAYAK.ai works
              </a>
            </div>
            <a href="#" className="hover:text-gray-400">
              Product Updates & New Features
            </a>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          {!sidebarOpen && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(true)}
              className="text-white hover:bg-gray-700"
            >
              <Menu className="w-5 h-5" />
            </Button>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <Button variant="outline" className="text-white border-gray-600 hover:bg-gray-700 bg-transparent">
              <Share className="w-4 h-4 mr-2" />
              Share
            </Button>
            <Button variant="ghost" size="sm" className="text-white hover:bg-gray-700">
              <MoreVertical className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="sm" className="text-white hover:bg-gray-700">
              <User className="w-5 h-5" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex p-4 gap-2">
          <Button
            variant={activeTab === "Planning" ? "default" : "outline"}
            className={`${activeTab === "Planning" ? "bg-white text-black" : "bg-gray-700 text-white border-gray-600"}`}
            onClick={() => setActiveTab("Planning")}
          >
            Planning
          </Button>
          <Button
            variant={activeTab === "Saved" ? "default" : "outline"}
            className={`${activeTab === "Saved" ? "bg-white text-black" : "bg-gray-700 text-white border-gray-600"}`}
            onClick={() => setActiveTab("Saved")}
          >
            Saved
          </Button>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="max-w-none">
            {/* Search Query */}
            <div className="mb-6">
              <h1 className="text-white text-xl font-medium mb-4">{destInfo.title}</h1>
            </div>

            {/* Answer Section */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Star className="w-5 h-5 text-yellow-500 fill-current" />
                <h2 className="text-white font-semibold">Answer</h2>
              </div>
              <div className="text-gray-300 space-y-4">
                <p>
                  The search results show that round-trip flights from BHO to New Delhi are available starting at
                  approximately $82 for basic economy class, with various departure times on Friday, July 18, and return
                  flights on Sunday, July 20. The flight options include airlines such as Air India and others, with
                  flight durations around 1.5 hours.
                </p>
                <p>
                  For accommodation, several hotels in New Delhi are available for these dates, with prices ranging from
                  $10 to $76 per night before taxes and fees. Notable options include Hotel Aerocity Nearest Landmark
                  Aerocity Delhi at $10, Hotel Godwin Deluxe at $34, and Pride Plaza Hotel, Aerocity New Delhi at $60.
                  These hotels offer free cancellation and have review scores mostly above 6.5, indicating generally
                  positive guest feedback.
                </p>
              </div>
            </div>

            {/* Flight Results */}
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-white font-semibold">Flight results</h2>
              </div>

              <div className="bg-gray-800 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-white font-medium">Flights {destInfo.route}</h3>
                  <ChevronDown className="w-5 h-5 text-gray-400" />
                </div>
                <div className="text-gray-400 text-sm mb-2">Bhopal, India → New Delhi, India</div>
                <div className="text-gray-400 text-sm">Round-trip • Jul 18 - Jul 20 • 1 adult • Economy</div>
                <div className="text-gray-400 text-sm">3 of 1839 matching flights</div>
              </div>

              {/* Flight Options */}
              <div className="space-y-4">
                {flightResults.map((flight, index) => (
                  <div key={index} className="bg-gray-800 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center text-white text-xs font-bold">
                          {flight.logo}
                        </div>
                        <div>
                          <div className="text-white font-medium">{flight.airline}</div>
                          <div className="text-gray-400 text-sm">{flight.departure}</div>
                          <div className="text-gray-400 text-sm">{flight.return}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2 mb-2">
                          {flight.badges.map((badge, badgeIndex) => (
                            <Badge
                              key={badgeIndex}
                              variant={badge === "Best" ? "default" : "secondary"}
                              className={`${badge === "Best" ? "bg-green-600" : "bg-blue-600"} text-white text-xs`}
                            >
                              {badge}
                            </Badge>
                          ))}
                          <Heart className="w-5 h-5 text-gray-400 hover:text-red-500 cursor-pointer" />
                        </div>
                        <div className="text-white text-xl font-bold">${flight.price}</div>
                        <div className="text-gray-400 text-sm">Economy</div>
                      </div>
                    </div>
                    <div className="mt-3 text-gray-400 text-sm space-y-1">
                      <div>{flight.route}</div>
                      <div>{flight.returnRoute}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Chat Input */}
        <div className="p-6 border-t border-gray-700">
          <div className="w-full">
            <div className="relative">
              <div className="flex items-center bg-gray-800 rounded-full border border-gray-600 p-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Ask follow up..."
                  className="flex-1 bg-transparent border-none text-white placeholder-gray-400 focus:ring-0 focus:outline-none px-4"
                />
                <div className="flex items-center gap-2 pr-2">
                  <Button size="sm" className="bg-white text-black hover:bg-gray-200 rounded-full w-8 h-8 p-0">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
