import express from 'express';
const app = express();
import bodyParser from 'body-parser';
import morgan from 'morgan';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import config from './config';
import FCM from 'fcm-node';
import cors from 'cors';
import async from 'async';
app.use(cors());

var Constants = require('./constants');
var User = require('./app/models/user');
var Mapping = require('./app/models/mapping');

const fcm = new FCM(config.server_key);

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
                    fcm_key: req.body.fcm_key,
                    access_token: token
                }, {
                    upsert: true
                }).exec()
                .then(() => {
                    res.json({
                        success: true,
                        status_code: 200,
                        message: 'New Access Token Provided and FCM key updated',
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
                fcm_key: req.body.fcm_key,
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
                                    var FCM_Keys = [];
                                    friends.map(o => User.findOne({
                                            email_id: o.email_id
                                        }).exec()
                                        .then((user) => {
                                            FCM_Keys.push(user.fcm_key);
                                        }));
                                    setTimeout(() => {
                                        let reg_tokens = FCM_Keys;
                                        console.log(reg_tokens);
                                        //Sending Push Notification to all connected friends with updated location
                                        //Checking if any friend is connected
                                        if (reg_tokens.length !== 0) {
                                            let message = {
                                                registration_ids: reg_tokens,
                                                collapseKey: 'demo',
                                                priority: 'high',
                                                contentAvailable: true,
                                                delayWhileIdle: true,
                                                timeToLive: 3,
                                                dryRun: true,
                                                data: {
                                                    data: {
                                                        "req": Constants.REQUEST_TYPE.filter(o => o.type === 'update-location').map(o => o.code)[0],
                                                        "latitude": userLocation.latitude,
                                                        "longitude": userLocation.longitude
                                                    }
                                                },
                                            };
                                            fcm.send(message, function (err, response) {
                                                if (err) {
                                                    console.log("Something has happened wrong: ", err);
                                                    res.json({
                                                        success: true,
                                                        status_code: 501,
                                                        message: 'Something went wrong'
                                                    });
                                                } else {
                                                    console.log("Successfully sent with response: ", response);
                                                    res.json({
                                                        success: true,
                                                        status_code: 200,
                                                        message: 'Location updated and Push Notification sends to all connected friends'
                                                    });
                                                }
                                            });
                                        } else {
                                            res.json({
                                                success: true,
                                                status_code: 200,
                                                message: 'Location updated but no friends connected'
                                            });
                                        }
                                    }, 1000)
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
                message: 'Something went wrong'
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
            let senderUser = user;
            //Checking if mapping already exists
            Mapping.findOne({
                    email_id: user.email_id,
                    friend_email_id: friend_email_id
                }).exec()
                .then((mapping) => {
                    if (!mapping) {
                        //Getting friend's details
                        User.findOne({
                                email_id: friend_email_id
                            }).exec()
                            .then((user) => {
                                let reg_token = [user.fcm_key];
                                let message = {
                                    registration_ids: reg_token,
                                    collapseKey: 'demo',
                                    priority: 'high',
                                    contentAvailable: true,
                                    delayWhileIdle: true,
                                    timeToLive: 3,
                                    dryRun: true,
                                    data: {
                                        data: {
                                            "req": Constants.REQUEST_TYPE.filter(o => o.type === 'connect-friend').map(o => o.code)[0],
                                            "eid": senderUser.email_id,
                                            "name": senderUser.name,
                                            "pic_url": senderUser.pic_url
                                        }
                                    },
                                    notification: {
                                        title: "Find Friends",
                                        icon: "find-friends",
                                        body: senderUser + " requesting you to share your location."
                                    }
                                };
                                //Sending Push Notification to Friend
                                fcm.send(message, function (err, response) {
                                    if (err) {
                                        console.log("Something has happened wrong: ", err);
                                        res.json({
                                            success: true,
                                            status_code: 501,
                                            message: 'Something went wrong'
                                        });
                                    } else {
                                        console.log("Successfully sent with response: ", response);
                                        res.json({
                                            success: true,
                                            status_code: 200,
                                            message: 'Push Notification send to friend'
                                        });
                                    }
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
                    } else {
                        res.json({
                            success: false,
                            status_code: 501,
                            message: 'You are already connected.'
                        });
                    }
                })
                .catch((err) => {
                    res.json({
                        success: false,
                        status_code: 501,
                        message: 'Something went wrong'
                    });
                });

        })
        .catch((err) => {
            if (err) console.error(err);
            res.json({
                success: false,
                status_code: 501,
                message: 'Something went wrong'
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
                        let mapping_1 = new Mapping({
                            email_id: receiverUser.email_id,
                            friend_email_id: senderUser.email_id
                        });
                        Mapping.findOne({
                                email_id: receiverUser.email_id,
                                friend_email_id: senderUser.email_id
                            }).exec()
                            .then((mapping) => {
                                if (!mapping) {
                                    mapping_1.save((err) => {
                                        if (err) throw err;
                                        console.log('Mapping saved successfully');
                                    });
                                    let reg_token = [receiverUser.fcm_key];
                                    let message = {
                                        registration_ids: reg_token,
                                        collapseKey: 'demo',
                                        priority: 'high',
                                        contentAvailable: true,
                                        delayWhileIdle: true,
                                        timeToLive: 3,
                                        dryRun: true,
                                        data: {
                                            data: {
                                                "req": Constants.REQUEST_TYPE.filter(o => o.type === 'friend-request').map(o => o.code)[0],
                                                "eid": senderUser.email_id,
                                                "status": "Accepted"
                                            }
                                        }
                                    };
                                    //Sending Push Notification to Friend
                                    fcm.send(message, function (err, response) {
                                        if (err) {
                                            console.log("Something went wrong: ", err);
                                            res.json({
                                                success: true,
                                                status_code: 501,
                                                message: 'Something went wrong'
                                            });
                                        } else {
                                            console.log("Response: ", response);
                                            res.json({
                                                success: true,
                                                status_code: 200,
                                                message: senderUser.name + ' has accepted your request'
                                            });
                                        }
                                    });
                                } else {
                                    res.json({
                                        success: true,
                                        status_code: 501,
                                        message: 'You have already accepted the request'
                                    });
                                }
                            })
                            .catch((err) => {
                                if (err) console.error(err);
                            });
                        let mapping_2 = new Mapping({
                            email_id: senderUser.email_id,
                            friend_email_id: receiverUser.email_id
                        });
                        Mapping.findOne({
                                email_id: senderUser.email_id,
                                friend_email_id: receiverUser.email_id
                            }).exec()
                            .then((mapping) => {
                                if (!mapping) {
                                    mapping_2.save((err) => {
                                        if (err) throw err;
                                        console.log('Mapping saved successfully');
                                    });
                                }
                            })
                            .catch((err) => {
                                if (err) console.error(err);
                            });
                    })
                    .catch((err) => {
                        if (err) console.error(err);
                        res.json({
                            success: false,
                            status_code: 501,
                            message: 'User does not exists'
                        });
                    });
            } else if (status === 'Denied') {
                User.findOne({
                        email_id: email_id
                    }).exec()
                    .then((user) => {
                        let receiverUser = user;
                        let reg_token = [receiverUser.fcm_key];
                        let message = {
                            registration_ids: reg_token,
                            collapseKey: 'demo',
                            priority: 'high',
                            contentAvailable: true,
                            delayWhileIdle: true,
                            timeToLive: 3,
                            dryRun: true,
                            data: {
                                data: {
                                    "req": Constants.REQUEST_TYPE.filter(o => o.type === 'friend-request').map(o => o.code)[0],
                                    "eid": senderUser.email_id,
                                    "status": "Denied"
                                }
                            }
                        };
                        //Sending Push Notification to Friend
                        fcm.send(message, function (err, response) {
                            if (err) {
                                console.log("Something has happened wrong: ", err);
                                res.json({
                                    success: true,
                                    status_code: 501,
                                    message: 'Something went wrong'
                                });
                            } else {
                                res.json({
                                    success: true,
                                    status_code: 200,
                                    message: senderUser.name + ' has denied your request'
                                });
                            }
                        });
                    })
                    .catch((err) => {
                        if (err) console.error(err);
                        res.json({
                            success: false,
                            status_code: 501,
                            message: 'Something went wrong'
                        });
                    });
            }
        })
        .catch((err) => {
            if (err) console.error(err);
            res.json({
                success: false,
                status_code: 501,
                message: 'Something went wrong'
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
                message: 'Something went wrong'
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
                        message: 'Something went wrong'
                    });
                })
        })
        .catch((err) => {
            if (err) console.error(err);
            res.json({
                success: false,
                status_code: 501,
                message: 'Something went wrong'
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