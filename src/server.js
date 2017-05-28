import express from 'express';
const app = express();
import bodyParser from 'body-parser';
import morgan from 'morgan';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import config from './config';
import gcm from 'node-gcm';
import cors from 'cors';

app.use(cors());

var User = require('./app/models/user');
var Mapping = require('./app/models/mapping');

const sender = new gcm.Sender(config.server_key);

const port = process.env.PORT || 8080;
const isProd = process.env.NODE_ENV === 'production';

mongoose.Promise = global.Promise;
mongoose.connect(isProd ? config.database_prod : config.database_dev, (err) => {
    if (err) console.error(err);
});
app.set('superSecret', config.secret);

app.use(bodyParser.urlencoded({
    extended: false
}));
app.use(bodyParser.json());

app.use(morgan('dev'));

var apiRoutes = express.Router();

app.get('/', (req, res) => {
    res.send('API Available');
});

apiRoutes.post('/login', (req, res) => {
    User.findOne({
            email_id: req.body.email_id
        })
        .exec()
        .then((user) => {
            user.access_token = '';
            let token = jwt.sign(user.email_id, app.get('superSecret'));
            User.update({
                    email_id: user.email_id
                }, {
                    gcm_key: req.body.gcm_key,
                    access_token: token
                }, {
                    upsert: true
                }).exec()
                .then(() => {
                    res.json({
                        success: true,
                        status_code: 200,
                        message: 'New Access Token Provided and GCM key updated',
                        token: token
                    });
                });
        })
        .catch((err) => {
            if (err) console.error(err);
            let newUser = new User({
                name: req.body.name,
                pic_url: req.body.pic_url,
                google_id: req.body.google_id,
                gcm_key: req.body.gcm_key,
                email_id: req.body.email_id,
                access_token: ''
            });
            let token = jwt.sign(newUser.email_id, app.get('superSecret'));
            newUser.access_token = token;
            newUser.save()
                .then(() => {
                    console.log('User saved successfully');
                    res.json({
                        success: true,
                        status_code: 200,
                        message: 'User Added.',
                        token: token
                    });
                })
                .catch((err) => {
                    if (err) console.error(err);
                    res.json({
                        success: false,
                        status_code: 501,
                        message: 'Failed to Add user',
                        error: err,
                    });
                })
        });
});

apiRoutes.use((req, res, next) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    if (token) {
        jwt.verify(token, app.get('superSecret'), (err, decoded) => {
            if (err) {
                return res.json({
                    success: false,
                    status_code: 401,
                    message: 'Failed to authenticate token.'
                });
            } else {
                req.decoded = decoded;
                next();
            }
        });
    } else {
        return res.status(403).send({
            success: false,
            status_code: 401,
            message: 'No token provided.'
        });

    }
});

//API for updating user location and sending updated location to connected friends
apiRoutes.post('/update-my-location', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    let latitude = req.body.latitude;
    let longitude = req.body.longitude;
    let location
    User.findOne({
            access_token: token
        }).exec()
        .then((user) => {
            //Updating user location
            User.update({
                    email_id: user.email_id
                }, {
                    location: {
                        latitude: latitude,
                        longitude: longitude
                    }
                }, {
                    upsert: true
                }).exec()
                .then(() => {
                    //Getting user detail with the updated location
                    User.findOne({
                            access_token: token
                        }).exec()
                        .then((user) => {
                            let userLocation = user.location;
                            //Getting all the friends, user is connected with
                            Mapping.find({
                                    friend_email_id: user.email_id
                                }).exec()
                                .then((friends) => {
                                    let connectedFriends = [];
                                    friends.map(o => User.findOne({
                                            email_id: o.email_id
                                        }).exec()
                                        .then((user) => {
                                            connectedFriends.push(user.gcm_key);
                                        }));
                                    //TODO - change this set Time out Code
                                    setTimeout(() => {
                                        let reg_token = connectedFriends;
                                        let message = new gcm.Message({
                                            collapseKey: 'demo',
                                            priority: 'high',
                                            contentAvailable: true,
                                            delayWhileIdle: true,
                                            timeToLive: 3,
                                            dryRun: true,
                                            data: userLocation
                                        });
                                        //Sending Push Notification to all connected friends with updated location
                                        //Checking if any friend is connected
                                        if (reg_token.length !== 0) {
                                            sender.send(message, {
                                                registrationTokens: reg_token
                                            }, (err, response) => {
                                                if (err) console.error(err);
                                                else {
                                                    console.log(response);
                                                    res.json({
                                                        success: true,
                                                        status_code: 200,
                                                        message: 'Location updated and Push Notification sends to all connected friends'
                                                    });
                                                };
                                            });
                                        } else {
                                            res.json({
                                                success: true,
                                                status_code: 200,
                                                message: 'Location updated but no friends connected'
                                            });
                                        }
                                    }, 1000);
                                })
                                .catch((err) => {
                                    if (err) console.log(err);
                                    res.json({
                                        success: true,
                                        status_code: 501,
                                        message: 'User not found'
                                    });
                                });
                        })
                        .catch((err) => {
                            if (err) console.log(err);
                            res.json({
                                success: true,
                                status_code: 501,
                                message: 'User not found'
                            });
                        });
                })
                .catch((err) => {
                    if (err) console.log(err);
                    res.json({
                        success: true,
                        status_code: 501,
                        message: 'Unable to update location'
                    });
                });
        })
        .catch((err) => {
            if (err) console.log(err);
            res.json({
                success: false,
                status_code: 501,
                message: 'Error'
            });
        });
});

apiRoutes.post('/connect-friend', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    let friend_email_id = req.body.friend_email_id;
    //Getting sender details
    User.findOne({
            access_token: token
        }).exec()
        .then((user) => {
            let senderUser = user.name
            //Getting friend's details
            User.findOne({
                    email_id: friend_email_id
                }).exec()
                .then((user) => {
                    let reg_token = [user.gcm_key];
                    let message = new gcm.Message({
                        collapseKey: 'demo',
                        priority: 'high',
                        contentAvailable: true,
                        delayWhileIdle: true,
                        timeToLive: 3,
                        dryRun: true,
                        data: {
                            key1: 'message1',
                            key2: 'message2'
                        },
                        notification: {
                            title: "Find Friends",
                            icon: "find-friends",
                            body: senderUser + " requesting you to share your location."
                        }
                    });
                    //Sending Push Notification to Friend
                    sender.send(message, {
                        registrationTokens: reg_token
                    }, (err, response) => {
                        if (err) console.error(err);
                        else {
                            console.log(response);
                            res.json({
                                success: true,
                                status_code: 501,
                                message: 'Push Notification send to friend'
                            });
                        };
                    });
                })
                .catch((err) => {
                    if (err) console.error(err);
                    res.json({
                        success: false,
                        status_code: 501,
                        message: 'Friend does not exists'
                    });
                });
        })
        .catch((err) => {
            if (err) console.error(err);
            res.json({
                success: false,
                status_code: 501,
                message: err
            });
        });
});

apiRoutes.post('/friend-request', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    let email_id = req.body.email_id;
    let status = req.body.status;
    User.findOne({
            access_token: token
        }).exec()
        .then((user) => {
            let senderUser = user;
            if (status === 'Accepted') {
                User.findOne({
                        email_id: email_id
                    }).exec()
                    .then((user) => {
                        let receiverUser = user;
                        let mapping = new Mapping({
                            email_id: receiverUser.email_id,
                            friend_email_id: senderUser.email_id
                        });
                        mapping.save((err) => {
                            if (err) throw err;
                            console.log('Mapping saved successfully');
                        });
                        let reg_token = [receiverUser.gcm_key];
                        let message = new gcm.Message({
                            collapseKey: 'demo',
                            priority: 'high',
                            contentAvailable: true,
                            delayWhileIdle: true,
                            timeToLive: 3,
                            dryRun: true,
                            notification: {
                                title: "Find Friends",
                                icon: "find-friends",
                                body: senderUser.name + " has accepted your request"
                            }
                        });
                        //Sending Push Notification to Friend
                        sender.send(message, {
                            registrationTokens: reg_token
                        }, (err, response) => {
                            if (err) console.error(err);
                            else {
                                console.log(response);
                                res.json({
                                    success: true,
                                    status_code: 200,
                                    message: senderUser.name + ' has accepted your request'
                                });
                            };
                        });

                    })
                    .catch((err) => {
                        if (err) console.error(err);
                        res.json({
                            success: false,
                            status_code: 501,
                            message: err
                        });
                    });
            } else if (status === 'Denied') {
                User.findOne({
                        email_id: email_id
                    }).exec()
                    .then((user) => {
                        let receiverUser = user;
                        let reg_token = [receiverUser.gcm_key];
                        let message = new gcm.Message({
                            collapseKey: 'demo',
                            priority: 'high',
                            contentAvailable: true,
                            delayWhileIdle: true,
                            timeToLive: 3,
                            dryRun: true,
                            notification: {
                                title: "Find Friends",
                                icon: "find-friends",
                                body: senderUser.name + " has denied your request"
                            }
                        });
                        //Sending Push Notification to Friend
                        sender.send(message, {
                            registrationTokens: reg_token
                        }, (err, response) => {
                            if (err) console.error(err);
                            else {
                                console.log(response);
                                res.json({
                                    success: true,
                                    status_code: 200,
                                    message: senderUser.name + ' has denied your request'
                                });
                            };
                        });

                    })
                    .catch((err) => {
                        if (err) console.error(err);
                        res.json({
                            success: false,
                            status_code: 501,
                            message: err
                        });
                    });
            }
        })
        .catch((err) => {
            if (err) console.error(err);
            res.json({
                success: false,
                status_code: 501,
                message: err
            });
        })

});

apiRoutes.post('/disconnect', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    let friend_email_id = req.body.friend_email_id;
    //Getting User details
    User.findOne({
            access_token: token
        }).exec()
        .then((user) => {
            //Disconnect all connected friends if no email_id provided
            if (!friend_email_id) {
                Mapping.remove({
                    email_id: user.email_id
                }, (err) => {
                    if (err) throw err;
                    res.json({
                        success: true,
                        status_code: 200,
                        message: 'All friends disconnected'
                    });
                });
            }
            //Disconnect friend with provided email_id
            else {
                Mapping.remove({
                    email_id: user.email_id,
                    friend_email_id: friend_email_id
                }, (err) => {
                    if (err) throw err;
                    res.json({
                        success: true,
                        status_code: 200,
                        message: 'Friend disconnected'
                    });
                });
            }
        })
        .catch((err) => {
            if (err) console.error(err);
            res.json({
                success: false,
                status_code: 501,
                message: err
            });
        });

});

apiRoutes.get('/get-connected', (req, res) => {
    let token = req.body.token || req.query.token || req.headers['x-access-token'];
    User.findOne({
            access_token: token
        }).exec()
        .then((user) => {
            Mapping.find({
                    email_id: user.email_id
                }).exec()
                .then((mapping) => {
                    let friends = [];
                    mapping.map(o => User.find({
                        email_id: o.friend_email_id
                    }, (err, user) => {
                        if (err) throw err;
                        if (user) {
                            friends.push(user.map(o => ({
                                'name': o.name,
                                'pic_url': o.pic_url,
                                'email_id': o.email_id,
                            }))[0]);
                        }
                    }));
                    setTimeout(() => {
                        res.json({
                            success: true,
                            status_code: 200,
                            message: 'List of connected friends',
                            data: friends
                        })
                    }, 1000);
                })
                .catch((err) => {
                    if (err) console.error(err);
                    res.json({
                        success: false,
                        status_code: 501,
                        message: err
                    });
                })
        })
        .catch((err) => {
            if (err) console.error(err);
            res.json({
                success: false,
                status_code: 501,
                message: err
            });
        });
});

app.use('/api', apiRoutes);

app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'https') {
        res.redirect('http://' + req.hostname + req.url);
    } else {
        next();
    }
});

app.listen(port);
console.log('Server started at http://localhost:' + port);