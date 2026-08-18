SEED_MULTIPLIER = 874259691

players = {
    "ramos": (256903, {
        "ballcontrol": 3, "dribbling": 7, "crossing": 9, "shortpassing": 6, "longpassing": 9,
        "finishing": 1, "headingaccuracy": 7, "volleys": 6, "curve": 3, "freekickaccuracy": 1,
        "penalties": 7, "acceleration": 6, "sprintspeed": 4, "agility": 2, "balance": 9,
        "reactions": 5, "shotpower": 2, "jumping": 6, "stamina": 10, "strength": 9,
        "longshots": 4, "aggression": 0, "attackingposition": 4, "vision": 1, "composure": 3,
    }),
    "martegani": (262083, {
        "ballcontrol": 5, "dribbling": 2, "crossing": 1, "shortpassing": 0, "longpassing": 7,
        "finishing": 9, "headingaccuracy": 4, "volleys": 10, "curve": 1, "freekickaccuracy": 4,
        "penalties": 10, "acceleration": 7, "sprintspeed": 2, "agility": 5, "balance": 7,
        "reactions": 7, "shotpower": 5, "jumping": 6, "stamina": 3, "strength": 8,
        "longshots": 7, "aggression": 7, "interceptions": 9, "attackingposition": 7, "vision": 7,
        "composure": 3, "marking": 6, "standingtackle": 8, "slidingtackle": 4,
    }),
    "ferati": (229354, {
        "ballcontrol": 2, "dribbling": 2, "crossing": 8, "shortpassing": 7, "longpassing": 3,
        "finishing": 2, "headingaccuracy": 4, "volleys": 1, "curve": 0, "freekickaccuracy": 3,
        "penalties": 6, "acceleration": 5, "sprintspeed": 2, "agility": 4, "balance": 5,
        "reactions": 3, "shotpower": 4, "jumping": 2, "stamina": 6, "strength": 0,
        "longshots": 8, "aggression": 8, "interceptions": 3, "attackingposition": 7, "vision": 5,
        "composure": 2, "marking": 8, "standingtackle": 8, "slidingtackle": 1,
    }),
}

ferati_radius_four = {
    "acceleration", "sprintspeed", "agility", "balance", "stamina", "reactions", "composure",
    "vision", "ballcontrol", "crossing", "dribbling", "freekickaccuracy", "longpassing",
    "shortpassing", "shotpower", "curve", "penalties",
}


def fifa_randoms(player_id):
    state = (SEED_MULTIPLIER * player_id) & 0xFFFFFFFF
    result = []
    for _ in range(34):
        while True:
            product = state * 0x41C64E6D + 0x3039
            state = product & 0xFFFFFFFF
            sample = (product >> 16) & 0xFFFFFFFF
            remainder = sample % 99
            if ((sample + 98 - remainder) & 0xFFFFFFFF) >= sample:
                result.append(remainder)
                break
    return result


randoms = {name: fifa_randoms(player_id) for name, (player_id, _) in players.items()}
attributes = list(players["martegani"][1])
for attribute in attributes:
    candidates = []
    for index in range(34):
        matches = True
        for player_name, (_, expected) in players.items():
            if attribute not in expected:
                continue
            radius = 4 if player_name == "ferati" and attribute in ferati_radius_four else 5
            actual = ((radius * 2 + 1) * randoms[player_name][index]) // 100
            if actual != expected[attribute]:
                matches = False
                break
        if matches:
            candidates.append(index)
    print(f"{attribute:20} {candidates}")

print("\nLikely enum order comparison")
likely = [
    "acceleration", "sprintspeed", "agility", "balance", "jumping", "stamina", "strength", "reactions",
    "aggression", "interceptions", "composure", "attackingposition", "vision", "ballcontrol", "crossing",
    "dribbling", "finishing", "freekickaccuracy", "headingaccuracy", "longpassing", "shortpassing", "marking",
    "shotpower", "longshots", "standingtackle", "slidingtackle", "volleys", "curve", "penalties",
]
for index, attribute in enumerate(likely):
    expected_values = []
    actual_values = []
    for player_name, (_, expected) in players.items():
        radius = 4 if player_name == "ferati" and attribute in ferati_radius_four else 5
        actual_values.append(((radius * 2 + 1) * randoms[player_name][index]) // 100)
        expected_values.append(expected.get(attribute))
    print(f"{index:2} {attribute:20} expected={expected_values} actual={actual_values}")
