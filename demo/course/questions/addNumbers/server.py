import random

def generate(data):
    data["params"]["a"] = random.randint(1, 9)
    data["params"]["b"] = random.randint(1, 9)
    data["correct_answers"]["c"] = data["params"]["a"] + data["params"]["b"]
