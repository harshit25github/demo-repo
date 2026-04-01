# AI Agent Requirements — Final Tooling and Context Contract

## 1. Objective

Build an AI agent that helps users across the flight search, listing, and checkout journey by:

- answering dynamic questions using authoritative runtime data
- performing only selected backend-safe actions through tools
- guiding the user for UI/form actions instead of directly manipulating the DOM

This document defines:

- the final **tool-backed actions**
- the **guidance-only actions**
- the **dynamic context** required at runtime
- the **static context** required as product knowledge
- the expected **contracts** between the agent and the app

---

## 2. Operating Principle

### 2.1 What the agent will do

The agent will:

- use **tools** for read/query actions and backend-safe side effects
- use **runtime context** to understand the current page, selected state, price state, and eligibility state
- guide the user step by step for UI interactions such as toggles, dropdowns, field edits, and step navigation

### 2.2 What the agent will not do

The agent will **not**:

- manipulate the DOM directly
- click CSS/XPath selectors directly
- toggle checkboxes directly through DOM automation
- type into fields directly through DOM automation
- depend on OCR or screenshot parsing in production for operational decisions

### 2.3 UI handling model

```text
User request
→ Agent identifies intent
→ If backend-safe action exists, call tool
→ If UI/form action is needed, use runtime UI context to guide user
→ App remains source of truth for state
→ UI rerenders from app state
```

### 2.4 Core architecture rule

The app should expose:

1. **tool APIs** for read/query actions and backend-safe side effects
2. **runtime UI context** so the agent can accurately guide the user for UI/form interactions

---

## 3. Final Tool Scope

These are the final tools the agent should be able to use.

## 3.1 Flight and fare information tools

### `get_flight_details`

**Purpose:**  
Return authoritative itinerary details for the selected or referenced flight.

**Why needed:**  
Used when the user asks about flight timings, stops, airline, route, or duration.

**Minimum inputs:**
- `itinerary_id`

**Expected output:**
- airline
- origin
- destination
- departure time
- arrival time
- duration
- stops
- fare family if available
- restrictions summary if available

---

### `get_fare_rules`

**Purpose:**  
Return cancellation, refund, and change-related rules for the fare.

**Why needed:**  
Used when the user asks whether a ticket is refundable, changeable, or subject to penalties.

**Minimum inputs:**
- `itinerary_id`
- `fare_id` if separate

**Expected output:**
- cancellation rules
- refundability
- change rules
- penalty summary
- fare restrictions
- disclaimers / warnings

---

## 3.2 Promotions and promo code tools

### `get_contextual_promotions`

**Purpose:**  
Return the offers or promo codes relevant to the current page, booking context, and user eligibility.

**Why needed:**  
Used when the user asks:
- “Any promo code available?”
- “What offer can I use?”
- “Is there any app-only deal?”

**Minimum inputs:**
- `page_id`
- `search_id` or `checkout_id` if relevant
- `user_context`

**Expected output:**
- list of offers
- promo code
- offer headline / label
- eligibility
- discount type / amount
- whether it applies to airfare, service fee, booking fee, or another component
- expiry
- restrictions
- stackability / combination rules if applicable

---

### `check_promo_eligibility`

**Purpose:**  
Validate whether a promo code is applicable to the current itinerary or checkout context.

**Why needed:**  
Used when the user asks:
- “Is this promo code valid?”
- “Will this code work on this booking?”
- “Why is this code not applicable?”

**Minimum inputs:**
- `promo_code`
- `search_id` or `checkout_id` or `itinerary_id`
- `user_context`

**Expected output:**
- valid / invalid
- applicable / not applicable
- reason code
- estimated discount
- applicability scope
- restrictions summary

---

## 3.3 Alert and notification tools

### `create_price_alert`

**Purpose:**  
Create a backend-tracked price alert for a route/date context.

**Why needed:**  
Used when the user asks:
- “Notify me if the price drops”
- “Set an alert for this flight / route”

**Minimum inputs:**
- `route`
- `departure_date`
- `return_date` if roundtrip
- `trip_type`
- `channel`
- `target_price` if supported

**Expected output:**
- `alert_id`
- created / failed status
- tracked route/date
- threshold if any
- selected channel
- confirmation message
- reason code if not created

---

### `get_price_alert_status`

**Purpose:**  
Check whether an alert already exists and return its current configuration.

**Why needed:**  
Used to avoid duplicate alerts and to answer:
- “Is an alert already set?”
- “What alert is active for this trip?”

**Minimum inputs:**
- `alert_id` or `route + date`

**Expected output:**
- active / inactive
- threshold
- channel
- created time
- tracked route/date
- error / block reason if unavailable

---

### `get_notification_capability`

**Purpose:**  
Determine whether notifications can be used for alerts, and through which channel.

**Why needed:**  
Price alert setup may depend on:
- push permission
- login state
- channel availability

**Minimum inputs:**
- `user_context`
- `device_context`

**Expected output:**
- permission status
- available channels (`push`, `email`, `sms`, etc.)
- login required or not
- unsupported reasons if any

---

## 3.4 Checkout, pricing, and add-on information tools

### `get_checkout_context`

**Purpose:**  
Return the authoritative current checkout state.

**Why needed:**  
This is the main runtime context tool. It powers:
- “What should I do next?”
- “What is currently selected?”
- “Why can’t I continue?”
- “What add-ons are currently enabled?”

**Minimum inputs:**
- `checkout_id`

**Expected output:**
- selected itinerary
- current checkout step
- selected baggage state
- selected support package
- travel protection selected state
- travel assist selected state
- flexible ticket selected state
- promo state
- price summary
- `can_continue`
- `blocking_reasons`
- completed steps if available

---

### `get_baggage_options`

**Purpose:**  
Return baggage options and fees for the itinerary.

**Why needed:**  
Used when the user asks:
- “What baggage options are available?”
- “How much is checked baggage?”
- “What bag can I add?”

**Minimum inputs:**
- `itinerary_id`
- `passenger_id` if needed
- `segment_id` if needed

**Expected output:**
- baggage options
- bag type
- price
- restrictions
- segment/passenger applicability
- checked vs cabin distinction if relevant

---

### `get_support_package_options`

**Purpose:**  
Return support package tiers and feature differences.

**Why needed:**  
Used when the user asks:
- “What is the difference between Standard / Premium / Supreme?”
- “Which package includes faster support?”

**Minimum inputs:**
- `checkout_id`

**Expected output:**
- package list
- package IDs
- prices
- feature matrix
- important conditions / limits

---

### `get_travel_protection_details`

**Purpose:**  
Return authoritative details for travel protection.

**Why needed:**  
Used when the user asks:
- “What does travel protection include?”
- “Is it worth taking?”
- “What is covered?”

**Minimum inputs:**
- `checkout_id`
- `plan_id` if needed

**Expected output:**
- coverage summary
- exclusions
- disclaimers
- price
- provider / product type if relevant

---

### `get_travel_assist_details`

**Purpose:**  
Return details for Travel Assist Classic.

**Why needed:**  
Used when the user asks what Travel Assist includes and how it differs from other support options.

**Minimum inputs:**
- `checkout_id`

**Expected output:**
- included services
- emergency / assistance scope
- limits / restrictions
- disclaimers
- price

---

### `get_flexible_ticket_details`

**Purpose:**  
Return details for Flexible Ticket and related watcher/flexibility coverage.

**Why needed:**  
Used when the user asks:
- “What flexibility does this add-on provide?”
- “What changes can I make?”
- “What does it include?”

**Minimum inputs:**
- `checkout_id`

**Expected output:**
- change / rebooking notes
- cancellation notes
- time window if applicable
- fare increase notes
- watcher-related details if included
- restrictions
- price

---

### `get_price_breakdown`

**Purpose:**  
Return an authoritative pricing breakdown for the current checkout.

**Why needed:**  
Used when the user asks:
- “What is included in this total?”
- “Why did the price change?”
- “What exactly am I paying for?”

**Minimum inputs:**
- `checkout_id`

**Expected output:**
- base fare
- taxes and fees
- service fee
- add-ons total
- promo discount
- grand total
- currency
- billing notes if relevant

---

## 3.5 Final tool list

```text
get_flight_details
get_fare_rules
get_contextual_promotions
check_promo_eligibility
create_price_alert
get_price_alert_status
get_notification_capability
get_checkout_context
get_baggage_options
get_support_package_options
get_travel_protection_details
get_travel_assist_details
get_flexible_ticket_details
get_price_breakdown
```

---

## 4. Guidance-Only Actions

These actions will **not** be tool-backed in the current plan.  
The agent should guide the user using runtime page/component context.

```text
search_flights
update_search_context
select_flight
apply_promo_code
remove_promo_code
select_baggage
select_support_package
set_travel_protection
set_travel_assist_classic
set_flexible_ticket
continue_checkout_step
go_to_checkout_step
```

### 4.1 Guidance expectation

For these actions, the agent should be able to tell the user:

- which page they should be on
- which section they should look for
- the exact component label
- whether it is a toggle, dropdown, text input, button, or step tab
- what to do next
- what change they should expect after the action
- whether they should verify price changes after the action

### 4.2 Example guidance behaviors

#### User wants to apply a promo code
The agent should guide:
- go to the checkout details page
- locate the promo code input
- enter the code
- tap/click Apply
- verify whether the total updated

#### User wants to enable Travel Assist Classic
The agent should guide:
- stay on the checkout details page
- scroll to the add-ons section
- locate “Travel Assist Classic”
- turn the toggle on / select the checkbox
- verify whether the total changed

#### User wants to continue to the next step
The agent should guide:
- review blockers if `can_continue = false`
- otherwise tap/click the “Continue to Next Step” CTA

---

## 5. Dynamic Context Required

This context must come live from the app/runtime and should be treated as authoritative.

## 5.1 Global app/session context

### Required fields
- `session_id`
- `page_id`
- `current_step`
- `locale`
- `currency`
- `market`
- `is_logged_in`
- `device_type`
- `notification_permission_status`
- `available_notification_channels`

### Why needed
- identify where the user is in the journey
- know whether features depend on login or device capabilities
- give correct pricing and localized guidance
- support alert creation and notification reasoning

### Suggested shape

```json
{
  "app_context": {
    "session_id": "sess_123",
    "page_id": "checkout_details",
    "current_step": "details",
    "locale": "en-US",
    "currency": "USD",
    "market": "US",
    "is_logged_in": false,
    "device_type": "android_app",
    "notification_permission_status": "granted",
    "available_notification_channels": ["push"]
  }
}
```

---

## 5.2 Search context

### Required fields
- `trip_type`
- `origin`
- `destination`
- `departure_date`
- `return_date` if roundtrip
- `travelers`
- `cabin_class`

### Useful fields
- `active_sort`
- `active_filters`
- `result_count`

### Why needed
- power search/listing reasoning
- enable alert creation
- explain why listings look the way they do
- answer “what am I searching for?” style questions

### Suggested shape

```json
{
  "search_context": {
    "trip_type": "one_way",
    "origin": "JLR",
    "destination": "DEL",
    "departure_date": "2026-04-23",
    "return_date": null,
    "travelers": 1,
    "cabin_class": "economy",
    "active_sort": "recommended",
    "active_filters": {
      "stops": "nonstop"
    },
    "result_count": 24
  }
}
```

---

## 5.3 Listing context

### Required fields
- `search_id`
- `visible_flights[]`

### Useful fields
- `selected_flight_id`
- `recommended_flight_id`
- `cheapest_flight_id`
- `current_price_snapshot`
- `fare_change_detected`

### Why needed
- answer flight comparison questions
- help user pick a flight
- explain cheapest vs recommended
- support alert logic

### Suggested shape

```json
{
  "listing_context": {
    "search_id": "srch_123",
    "visible_flights": [
      {
        "flight_id": "flt_1",
        "airline": "IndiGo",
        "origin": "JLR",
        "destination": "DEL",
        "departure_time": "08:50",
        "arrival_time": "10:25",
        "duration_minutes": 95,
        "stops": 0,
        "price": 83.99,
        "currency": "USD",
        "badges": ["recommended", "cheapest"]
      }
    ],
    "selected_flight_id": null,
    "recommended_flight_id": "flt_1",
    "cheapest_flight_id": "flt_1",
    "current_price_snapshot": 83.99,
    "fare_change_detected": false
  }
}
```

---

## 5.4 Checkout context

### Required fields
- `checkout_id`
- `current_step`
- `selected_itinerary`
- `selected_support_package`
- `travel_protection_selected`
- `travel_assist_selected`
- `flexible_ticket_selected`
- `promo_state`
- `price_breakdown`
- `can_continue`
- `blocking_reasons`

### Useful fields
- `selected_baggage`
- `completed_steps`

### Why needed
- explain selected state
- guide the user through checkout
- explain totals
- tell the user why they cannot continue
- support add-on explanations

### Suggested shape

```json
{
  "checkout_context": {
    "checkout_id": "chk_123",
    "current_step": "details",
    "selected_itinerary": {
      "itinerary_id": "itn_1",
      "airline": "IndiGo",
      "origin": "JLR",
      "destination": "DEL",
      "departure_time": "08:50",
      "arrival_time": "10:25"
    },
    "selected_baggage": null,
    "selected_support_package": "standard",
    "travel_protection_selected": false,
    "travel_assist_selected": false,
    "flexible_ticket_selected": false,
    "promo_state": {
      "active_promo_code": null,
      "applied": false
    },
    "price_breakdown": {
      "base_fare": 83.99,
      "taxes_and_fees": 0.0,
      "service_fee": 0.0,
      "add_ons_total": 0.0,
      "discount_total": 0.0,
      "grand_total": 83.99,
      "currency": "USD"
    },
    "can_continue": true,
    "blocking_reasons": [],
    "completed_steps": ["details"]
  }
}
```

---

## 5.5 Promo and offer context

### Required fields
- `eligible_offers[]`
- `promo_code`
- `applies_to`
- `expiry`
- `eligibility_rules`

### Useful fields
- `stackable`
- `estimated_discount`

### Why needed
- answer promo availability questions
- explain promo restrictions
- avoid hallucinating offer validity

### Suggested shape

```json
{
  "promo_context": {
    "eligible_offers": [
      {
        "offer_id": "offer_1",
        "promo_code": "FLY100",
        "headline": "Save up to $100",
        "applies_to": "service_fee",
        "eligible": true,
        "expiry": "2026-04-30T23:59:59Z",
        "eligibility_rules": ["app_only"],
        "stackable": false,
        "estimated_discount": 20.0
      }
    ]
  }
}
```

---

## 5.6 Alert and notification context

### Required fields
- `notification_permission_status`
- `available_channels[]`
- `existing_alerts[]`

### Useful fields
- `target_price`
- `login_required_for_alerts`
- `tracked_route`
- `tracked_dates`

### Why needed
- tell whether alert can be created
- avoid duplicate alerts
- explain missing permissions or blockers

### Suggested shape

```json
{
  "alert_context": {
    "notification_permission_status": "granted",
    "available_channels": ["push"],
    "login_required_for_alerts": false,
    "existing_alerts": [
      {
        "alert_id": "alrt_1",
        "route": "JLR-DEL",
        "departure_date": "2026-04-23",
        "target_price": null,
        "channel": "push",
        "active": true
      }
    ]
  }
}
```

---

## 5.7 Runtime UI context for guidance-only actions

This is critical because the agent is no longer executing UI actions directly.  
To guide the user accurately, the app should expose what is currently visible and interactive.

### Required fields
- `visible_sections[]`
- `visible_components[]`
- `available_user_interactions[]`
- `completion_state`

### `visible_sections[]`
Each section should ideally expose:
- `section_id`
- `label`
- `visible`
- `order`

### `visible_components[]`
Each component should ideally expose:
- `component_id`
- `label`
- `type` (`toggle`, `checkbox`, `button`, `text_input`, `dropdown`, `radio`, `tab`, `link`)
- `section_id`
- `visible`
- `enabled`
- `selected`
- `value`
- `price_impact` if relevant

### `available_user_interactions[]`
Should expose the actions the user can manually take on the current page, such as:
- apply promo code
- toggle travel protection
- toggle travel assist
- select support package
- continue to next step

### `completion_state`
Should expose:
- `can_continue`
- `blocking_reasons[]`
- `missing_required_fields[]`

### Why needed
This allows the agent to say things like:
- “Look for the Travel Assist Classic card in the add-ons section”
- “The promo code input is visible and enabled”
- “You can continue to the next step”
- “You can’t continue yet because passenger details are missing”

### Suggested shape

```json
{
  "ui_context": {
    "visible_sections": [
      {
        "section_id": "addons",
        "label": "Add-ons",
        "visible": true,
        "order": 3
      }
    ],
    "visible_components": [
      {
        "component_id": "travel_assist_toggle",
        "label": "Travel Assist Classic",
        "type": "toggle",
        "section_id": "addons",
        "visible": true,
        "enabled": true,
        "selected": false,
        "value": false,
        "price_impact": true
      },
      {
        "component_id": "promo_code_input",
        "label": "Promo Code",
        "type": "text_input",
        "section_id": "pricing",
        "visible": true,
        "enabled": true,
        "selected": false,
        "value": null,
        "price_impact": true
      }
    ],
    "available_user_interactions": [
      "apply_promo_code",
      "set_travel_assist_classic",
      "continue_checkout_step"
    ],
    "completion_state": {
      "can_continue": true,
      "blocking_reasons": [],
      "missing_required_fields": []
    }
  }
}
```

---

## 5.8 Action availability context

The app should expose which actions are currently available so the agent does not guess.

### Suggested shape

```json
{
  "available_actions": [
    {
      "action_id": "create_price_alert",
      "enabled": true,
      "requires_confirmation": false,
      "type": "tool"
    },
    {
      "action_id": "set_travel_assist_classic",
      "enabled": true,
      "requires_confirmation": false,
      "type": "guidance"
    },
    {
      "action_id": "continue_checkout_step",
      "enabled": true,
      "requires_confirmation": false,
      "type": "guidance"
    }
  ]
}
```

### Why needed
- prevents hallucinated actions
- lets the agent know whether something is currently possible
- helps the agent decide whether to guide, explain, or report a blocker

---

## 6. Static Context Required

This does not need to be fetched live on every turn, but the agent still needs it as product knowledge.

## 6.1 Page map

The agent needs a stable definition of the major pages and steps, for example:

- `home`
- `search_form`
- `listing_page`
- `checkout_details`
- `checkout_passengers`
- `checkout_seats`
- `checkout_payment`

For each page, document:
- purpose
- user goal
- major sections
- common actions
- next-step behavior
- blockers / prerequisites

---

## 6.2 Section map

For each page, document the major sections and what they represent.

Examples:
- search summary
- filters and sort
- flight cards
- add-ons
- baggage
- support package
- travel protection
- travel assist
- flexible ticket
- promo code
- price details
- checkout stepper

For each section, document:
- section label
- purpose
- whether editable or informational
- related runtime state fields
- related user actions

---

## 6.3 Component semantics

The agent needs definitions for the UI components it refers to.

Examples:
- trip type selector
- origin field
- destination field
- departure date field
- return date field
- traveler/class selector
- flight result card
- promo code input
- baggage selector
- support package selector
- travel protection toggle
- travel assist toggle
- flexible ticket toggle
- step tabs
- continue button
- price summary block

For each component, document:
- label
- type
- what it represents
- whether it is editable or informational
- which runtime state powers it
- what user action it supports

---

## 6.4 Product / feature definitions

The agent needs stable, written definitions for the key product features.

Document definitions for:
- contextual promotions
- promo code behavior
- baggage terms
- support package tiers
- travel protection
- travel assist classic
- flexible ticket
- flight watcher if applicable
- fare rules terminology
- notification / price alert behavior

These definitions should be written so the agent can explain features without inventing policy details.

---

## 6.5 Business rules and constraints

The agent needs rule-level knowledge for:
- promo eligibility and exclusions
- app-only or login-only offers
- price alert eligibility
- baggage restrictions
- support package limitations
- travel protection disclaimers
- flexible ticket restrictions
- when prices may change due to revalidation
- what requires user confirmation
- market-specific restrictions if any

---

## 6.6 Guidance copy conventions

Since many actions are guidance-only, the agent should be given stylistic rules for user guidance.

Recommended guidance conventions:
- reference the page first
- reference the section second
- reference the control label third
- mention the interaction type
- mention what outcome the user should expect
- mention whether price may change

Example pattern:

```text
On the Checkout Details page, go to the Add-ons section, find “Travel Assist Classic,” and turn that toggle on. After enabling it, check whether your total price updates.
```

---

## 7. Tool/API Contract Expectations

Every tool should follow a consistent contract.

## 7.1 Common inputs

Where relevant, tools should accept:
- `session_id`
- `user_id` or guest session token
- `page_id`
- `search_id`
- `checkout_id`
- `itinerary_id`
- `locale`
- `currency`
- `market`
- `device_context`
- `auth_context`

---

## 7.2 Common response fields

Suggested standard response shape:

```json
{
  "success": true,
  "reason_code": null,
  "user_message": "Promo code is eligible for this booking.",
  "updated_session_state": {},
  "updated_checkout_state": {},
  "updated_price_breakdown": {},
  "available_next_actions": []
}
```

### Notes
- Informational tools may return empty update objects.
- Side-effect tools such as `create_price_alert` should still return success/failure plus authoritative resulting state.
- All failures should return stable `reason_code` values so the agent can explain blockers consistently.

---

## 7.3 Recommended metadata per tool or action

Each tool/action should expose metadata like:
- `requires_confirmation`
- `requires_login`
- `requires_permission`
- `price_impact`
- `reversible`
- `supported_markets`

This helps the agent decide whether to:
- execute immediately
- explain a blocker
- suggest a fallback
- tell the user to verify pricing after a manual change

---

## 8. What the App Team Needs to Provide

### 8.1 Tool layer
The app/backend should provide the final tool-backed APIs for:
- flight details
- fare rules
- promotions
- promo eligibility
- price alert creation/status
- notification capability
- checkout context
- baggage options
- support package options
- travel protection details
- travel assist details
- flexible ticket details
- price breakdown

### 8.2 Runtime context layer
The app should provide live context for:
- page and step state
- search state
- listing state
- checkout state
- promo state
- alert state
- visible sections/components
- completion and blockers
- available actions

### 8.3 Static knowledge layer
The product/business team should provide stable documentation for:
- page map
- section map
- component semantics
- feature definitions
- business rules
- guidance wording conventions

---

## 9. Final Summary

### 9.1 Tool-backed actions

```text
get_flight_details
get_fare_rules
get_contextual_promotions
check_promo_eligibility
create_price_alert
get_price_alert_status
get_notification_capability
get_checkout_context
get_baggage_options
get_support_package_options
get_travel_protection_details
get_travel_assist_details
get_flexible_ticket_details
get_price_breakdown
```

### 9.2 Guidance-only actions

```text
search_flights
update_search_context
select_flight
apply_promo_code
remove_promo_code
select_baggage
select_support_package
set_travel_protection
set_travel_assist_classic
set_flexible_ticket
continue_checkout_step
go_to_checkout_step
```

### 9.3 Key principle

The agent should not manipulate the DOM directly.  
Instead:
- tools handle backend-safe operations and authoritative queries
- runtime UI context enables accurate user guidance
- the app remains the source of truth for all state and rendering

---

## 10. Current Scope Boundaries

This document focuses on the current visible/search/listing/checkout-details flow and the agreed tool plan.

Likely future additions, but not fully covered here:
- passenger details page action model
- seat selection page action model
- payment entry and payment validation model
- final booking submission
- login/signup flows
- post-booking flows
